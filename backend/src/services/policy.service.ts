import type { PolicyDomain, PolicyVersion, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { canonicalSha256, reparse } from "../utils/canonical-json.js";
import {
  APPROVED_STARTING_VALUES,
  FEATURE_REQUIREMENTS,
  upgradePayload,
  type GatedFeature,
  isPending,
  pendingFields,
  POLICY_DOMAINS,
  validatePolicyPayload,
} from "./policy-schemas.js";

/**
 * Franchise policy governance. A policy version is drafted by one ADMIN, submitted (its payload hash
 * is pinned in a POLICY_PUBLISH approval request), and published only when a DIFFERENT admin approves
 * that exact hash. Both admins' roles are re-read from the database inside the approval transaction,
 * and database triggers enforce the same rules. Published versions never change; a newer version
 * supersedes the current one and takes effect at its effective date (never retroactively).
 *
 * Nothing here activates a financial feature: the readiness report and requirePolicy() only say
 * whether the required decisions have been published.
 */

type Tx = Prisma.TransactionClient;
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A requested effective date may be at most this far in the past (clock skew); otherwise refused. */
const EFFECTIVE_DATE_SKEW_MS = 60 * 1000;

/**
 * Database safeguards (triggers raising P0001, CHECK violations 23514) are the backstop for these
 * rules. If one fires, report a 409 with its message instead of a 500 — it means a rule was refused.
 */
function dbGuardError(err: unknown): HttpError | null {
  if (err instanceof HttpError || typeof err !== "object" || err === null) return null;
  const text = `${(err as { message?: string }).message ?? ""} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
  if (!/P0001|23514|check constraint|append-only|frozen|is not allowed|must be|cannot/.test(text)) return null;
  const detail = /(policy version|approval request|only an ADMIN|policy versions)[^"\\]*/.exec(text)?.[0]?.slice(0, 200) ?? "refused by a database safeguard";
  return new HttpError(409, "Refused by a database safeguard.", { code: "DB_GUARD", detail });
}
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw dbGuardError(err) ?? err;
  }
}

const lockDomain = (tx: Tx, domain: PolicyDomain) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eta-policy:${domain}`}))`;

async function audit(tx: Tx, actorId: string | null, action: string, policy: Pick<PolicyVersion, "id" | "domain" | "version" | "payloadSha256">, extra: Record<string, string | number | null> = {}) {
  await tx.auditLog.create({
    data: { actorId, action, target: policy.id, metadata: { domain: policy.domain, version: policy.version, payloadSha256: policy.payloadSha256, ...extra } },
  });
}

/** Locks and re-reads users' roles inside the transaction. */
async function rolesOf(tx: Tx, ids: string[]) {
  const rows = await tx.$queryRaw<{ id: string; role: string }[]>`SELECT "id", "role"::text AS "role" FROM "User" WHERE "id" = ANY(${ids}::text[]) FOR SHARE`;
  return new Map(rows.map((r) => [r.id, r.role]));
}

function assertValid(domain: PolicyDomain, payload: unknown) {
  const v = validatePolicyPayload(domain, payload);
  if (!v.ok) throw new HttpError(400, "The policy has validation errors.", { code: "INVALID_POLICY", issues: v.issues });
  return reparse<Record<string, unknown>>(v.payload);
}

function assertDomain(domain: unknown): PolicyDomain {
  if (typeof domain !== "string" || !POLICY_DOMAINS.includes(domain as PolicyDomain)) throw new HttpError(400, "Unknown policy domain.", { code: "UNKNOWN_DOMAIN" });
  return domain as PolicyDomain;
}

// ---------- Reads ----------

const withPeople = {
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  approvalRequest: { select: { id: true, status: true, requestedById: true, decidedById: true, decisionNote: true, decidedAt: true, expiresAt: true, payloadSha256: true, reason: true } },
} as const;

export function listPolicies(domain?: PolicyDomain) {
  return prisma.policyVersion.findMany({ where: domain ? { domain } : {}, orderBy: [{ domain: "asc" }, { version: "desc" }], include: withPeople });
}

export async function getPolicy(id: string) {
  const p = await prisma.policyVersion.findUnique({ where: { id }, include: withPeople });
  if (!p) throw new HttpError(404, "Not found");
  return p;
}

/** The version in force for `domain` at time `at` (published by then, effective by then; latest effective wins). */
export async function resolvePolicy(domain: PolicyDomain, at: Date = new Date(), db: Tx | typeof prisma = prisma) {
  return db.policyVersion.findFirst({
    where: { domain, status: { in: ["PUBLISHED", "SUPERSEDED"] }, publishedAt: { lte: at }, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
  });
}

/** Published but not yet effective (at most one per domain, since effective dates only move forward). */
function upcomingPolicy(domain: PolicyDomain, at: Date) {
  return prisma.policyVersion.findFirst({ where: { domain, status: "PUBLISHED", effectiveFrom: { gt: at } } });
}

export type DiffEntry = { path: string; change: "added" | "removed" | "changed"; before?: unknown; after?: unknown };

/** Path-level structural diff between two payloads (canonical comparison; arrays compared whole). */
export function diffPayloads(before: unknown, after: unknown, path = ""): DiffEntry[] {
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(before) && isObj(after) && !isPending(before) && !isPending(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => {
      const p = path ? `${path}.${k}` : k;
      if (!(k in before)) return [{ path: p, change: "added" as const, after: after[k] }];
      if (!(k in after)) return [{ path: p, change: "removed" as const, before: before[k] }];
      return diffPayloads(before[k], after[k], p);
    });
  }
  return canonicalSha256(before ?? null) === canonicalSha256(after ?? null) ? [] : [{ path: path || "(payload)", change: "changed", before, after }];
}

export async function policyDiff(id: string, against?: string) {
  const policy = await getPolicy(id);
  const base = against
    ? await prisma.policyVersion.findUnique({ where: { id: against } })
    : await prisma.policyVersion.findFirst({ where: { domain: policy.domain, status: "PUBLISHED", id: { not: policy.id } } });
  return {
    policy: { id: policy.id, version: policy.version, status: policy.status, payloadSha256: policy.payloadSha256 },
    base: base ? { id: base.id, version: base.version, status: base.status, payloadSha256: base.payloadSha256 } : null,
    changes: diffPayloads(base?.payload ?? {}, policy.payload),
  };
}

// ---------- Drafts ----------

export async function createDraft(input: { domain: unknown; actorId: string; from?: "STARTING_VALUES" | "CURRENT" | "VERSION"; versionId?: string; payload?: unknown }) {
  const domain = assertDomain(input.domain);
  let source: unknown = input.payload;
  if (source === undefined) {
    if (input.from === "VERSION" && input.versionId) {
      const v = await prisma.policyVersion.findUnique({ where: { id: input.versionId } });
      if (!v || v.domain !== domain) throw new HttpError(404, "Source version not found");
      source = upgradePayload(domain, v.payload as Record<string, unknown>);
    } else if (input.from === "CURRENT") {
      const current = await prisma.policyVersion.findFirst({ where: { domain, status: "PUBLISHED" } });
      if (!current) throw new HttpError(409, "There is no published version of this policy yet.", { code: "NO_CURRENT_POLICY" });
      source = upgradePayload(domain, current.payload as Record<string, unknown>);
    } else {
      source = APPROVED_STARTING_VALUES[domain];
    }
  }
  const payload = assertValid(domain, source);
  const payloadSha256 = canonicalSha256(payload);
  return guarded(() => prisma.$transaction(async (tx) => {
    await lockDomain(tx, domain);
    const last = await tx.policyVersion.aggregate({ where: { domain }, _max: { version: true } });
    const created = await tx.policyVersion.create({
      data: { domain, version: (last._max.version ?? 0) + 1, payload: payload as Prisma.InputJsonValue, payloadSha256, createdById: input.actorId },
    });
    await audit(tx, input.actorId, "POLICY_DRAFT_CREATED", created, { source: input.payload !== undefined ? "PAYLOAD" : (input.from ?? "STARTING_VALUES") });
    return created;
  }));
}

/** Saves a draft. `expectedSha` is the hash the editor loaded: a stale editor can't overwrite newer work. */
export async function updateDraft(input: { id: string; actorId: string; payload: unknown; expectedSha: string }) {
  const current = await prisma.policyVersion.findUnique({ where: { id: input.id } });
  if (!current) throw new HttpError(404, "Not found");
  if (current.status !== "DRAFT") throw new HttpError(409, `This version is ${current.status.toLowerCase().replace("_", " ")} and can no longer be edited.`, { code: "NOT_DRAFT" });
  if (current.createdById !== input.actorId) throw new HttpError(403, "Only the admin who created this draft can edit it.", { code: "NOT_DRAFT_OWNER" });
  const payload = assertValid(current.domain, input.payload);
  const payloadSha256 = canonicalSha256(payload);
  return guarded(() => prisma.$transaction(async (tx) => {
    const { count } = await tx.policyVersion.updateMany({
      where: { id: input.id, status: "DRAFT", payloadSha256: input.expectedSha },
      data: { payload: payload as Prisma.InputJsonValue, payloadSha256 },
    });
    if (count !== 1) throw new HttpError(409, "This draft changed since you opened it — reload to see the latest version.", { code: "STALE" });
    const updated = await tx.policyVersion.findUniqueOrThrow({ where: { id: input.id } });
    await audit(tx, input.actorId, "POLICY_DRAFT_UPDATED", updated, { previousSha256: input.expectedSha });
    return updated;
  }));
}

export async function discardDraft(input: { id: string; actorId: string; expectedSha: string }) {
  const current = await prisma.policyVersion.findUnique({ where: { id: input.id } });
  if (!current) throw new HttpError(404, "Not found");
  if (current.createdById !== input.actorId) throw new HttpError(403, "Only the admin who created this draft can discard it.", { code: "NOT_DRAFT_OWNER" });
  return guarded(() => prisma.$transaction(async (tx) => {
    const { count } = await tx.policyVersion.deleteMany({ where: { id: input.id, status: "DRAFT", payloadSha256: input.expectedSha } });
    if (count !== 1) throw new HttpError(409, "This draft changed or was already submitted.", { code: "STALE" });
    await audit(tx, input.actorId, "POLICY_DRAFT_DISCARDED", current);
    return { discarded: true };
  }));
}

// ---------- Submission and decisions ----------

export async function submitForApproval(input: { id: string; actorId: string; expectedSha: string; reason: string; effectiveFrom?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) throw new HttpError(400, "Explain the change for the approving admin (at least 5 characters).", { code: "REASON_REQUIRED" });
  let effectiveFrom: Date | null = null;
  if (input.effectiveFrom) {
    effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) throw new HttpError(400, "Invalid effective date.", { code: "INVALID_EFFECTIVE_DATE" });
    if (effectiveFrom.getTime() < now.getTime() - EFFECTIVE_DATE_SKEW_MS) throw new HttpError(400, "A policy can't take effect in the past.", { code: "EFFECTIVE_DATE_IN_PAST" });
  }
  const current = await prisma.policyVersion.findUnique({ where: { id: input.id } });
  if (!current) throw new HttpError(404, "Not found");
  if (current.createdById !== input.actorId) throw new HttpError(403, "Only the admin who created this draft can submit it.", { code: "NOT_DRAFT_OWNER" });
  // In a one-admin environment nobody could ever approve it: say so now instead of letting it expire.
  await requireTwoAdmins();
  // Re-validate and re-hash what is stored: the pinned hash must be of a valid, canonical payload.
  const payload = assertValid(current.domain, current.payload);
  if (canonicalSha256(payload) !== current.payloadSha256) throw new HttpError(409, "Stored payload hash mismatch.", { code: "HASH_MISMATCH" });

  return guarded(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PolicyVersion" WHERE "id" = ${input.id} FOR UPDATE`;
    const fresh = await tx.policyVersion.findUniqueOrThrow({ where: { id: input.id } });
    if (fresh.status !== "DRAFT") throw new HttpError(409, "This version was already submitted.", { code: "NOT_DRAFT" });
    if (fresh.payloadSha256 !== input.expectedSha) throw new HttpError(409, "This draft changed since you reviewed it — reload before submitting.", { code: "STALE" });
    const request = await tx.adminApprovalRequest.create({
      data: {
        action: "POLICY_PUBLISH",
        targetType: "PolicyVersion",
        targetId: fresh.id,
        payload: { domain: fresh.domain, version: fresh.version, payloadSha256: fresh.payloadSha256, effectiveFrom: effectiveFrom?.toISOString() ?? null },
        payloadSha256: fresh.payloadSha256,
        reason,
        openKey: `POLICY_PUBLISH:PolicyVersion:${fresh.id}`,
        requestedById: input.actorId,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
      },
    });
    const submitted = await tx.policyVersion.update({
      where: { id: fresh.id },
      data: { status: "PENDING_APPROVAL", submittedAt: now, approvalRequestId: request.id, effectiveFrom },
    });
    await audit(tx, input.actorId, "POLICY_SUBMITTED", submitted, { approvalRequestId: request.id, effectiveFrom: effectiveFrom?.toISOString() ?? null });
    return { policy: submitted, request };
  }));
}

export async function listApprovals(status?: string) {
  await expireStaleApprovalsQuietly();
  return prisma.adminApprovalRequest.findMany({
    where: { action: "POLICY_PUBLISH", ...(status ? { status: status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } }, policy: { select: { id: true, domain: true, version: true, status: true, payloadSha256: true, effectiveFrom: true } } },
  });
}

/**
 * Publishes a submitted policy. The approver supplies the hash they reviewed; publication happens only
 * if it equals both the request's pinned hash and the policy's stored hash. Runs in one transaction,
 * under the domain lock: concurrent approvals of one request — or of two versions of one domain — are
 * serialised, and each sees the other's result.
 */
export async function approvePublication(input: { requestId: string; approverId: string; expectedPayloadSha: string; note?: string | null; now?: Date }) {
  const pre = await prisma.adminApprovalRequest.findUnique({ where: { id: input.requestId } });
  if (!pre || pre.action !== "POLICY_PUBLISH") throw new HttpError(404, "Not found");
  const policyRef = await prisma.policyVersion.findUnique({ where: { id: pre.targetId }, select: { domain: true } });
  if (!policyRef) throw new HttpError(404, "Not found");

  try {
    return await approveInTransaction(input, policyRef.domain);
  } catch (err) {
    if (!(err instanceof ExpiredSignal)) throw err;
    await expireRequest(input.requestId, input.now ?? new Date());
    throw new HttpError(409, "This request expired — the draft must be submitted again.", { code: "EXPIRED" });
  }
}

/** Thrown inside the approval transaction so it rolls back; the expiry is then recorded separately. */
class ExpiredSignal extends Error {}

function approveInTransaction(input: { requestId: string; approverId: string; expectedPayloadSha: string; note?: string | null; now?: Date }, domain: PolicyDomain) {
  return guarded(() => prisma.$transaction(async (tx) => {
    await lockDomain(tx, domain);
    const now = input.now ?? new Date();
    await tx.$queryRaw`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${input.requestId} FOR UPDATE`;
    const request = await tx.adminApprovalRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    if (request.status !== "PENDING") throw new HttpError(409, `This request is already ${request.status.toLowerCase()}.`, { code: "ALREADY_DECIDED" });
    if (request.requestedById === input.approverId) throw new HttpError(403, "A different admin must approve this change.", { code: "SELF_APPROVAL" });
    const roles = await rolesOf(tx, [request.requestedById, input.approverId]);
    if (roles.get(input.approverId) !== "ADMIN") throw new HttpError(403, "Admin access required.", { code: "NOT_ADMIN" });
    if (roles.get(request.requestedById) !== "ADMIN") throw new HttpError(403, "The requesting admin no longer has admin access.", { code: "REQUESTER_NOT_ADMIN" });
    if (request.expiresAt.getTime() <= now.getTime()) throw new ExpiredSignal();

    await tx.$queryRaw`SELECT "id" FROM "PolicyVersion" WHERE "id" = ${request.targetId} FOR UPDATE`;
    const policy = await tx.policyVersion.findUniqueOrThrow({ where: { id: request.targetId } });
    if (policy.status !== "PENDING_APPROVAL") throw new HttpError(409, "This policy is not awaiting approval.", { code: "NOT_PENDING" });
    const storedSha = canonicalSha256(policy.payload);
    if (input.expectedPayloadSha !== request.payloadSha256 || request.payloadSha256 !== policy.payloadSha256 || storedSha !== policy.payloadSha256) {
      throw new HttpError(409, "The policy you reviewed doesn't match what was submitted. Nothing was published.", { code: "HASH_MISMATCH" });
    }

    const current = await tx.policyVersion.findFirst({ where: { domain: policy.domain, status: "PUBLISHED", id: { not: policy.id } } });
    const latestEffective = await tx.policyVersion.aggregate({ where: { domain: policy.domain, status: { in: ["PUBLISHED", "SUPERSEDED"] } }, _max: { effectiveFrom: true } });
    const effectiveFrom = policy.effectiveFrom && policy.effectiveFrom > now ? policy.effectiveFrom : now;
    if (latestEffective._max.effectiveFrom && effectiveFrom < latestEffective._max.effectiveFrom) {
      throw new HttpError(409, "Another version of this policy takes effect later; this one would take effect before it.", { code: "EFFECTIVE_DATE_CONFLICT" });
    }

    await tx.adminApprovalRequest.update({ where: { id: request.id }, data: { status: "APPROVED", decidedById: input.approverId, decidedAt: now, decisionNote: input.note ?? null } });
    if (current) {
      const superseded = await tx.policyVersion.update({ where: { id: current.id }, data: { status: "SUPERSEDED", supersededAt: now } });
      await audit(tx, input.approverId, "POLICY_SUPERSEDED", superseded, { supersededBy: policy.id });
    }
    const published = await tx.policyVersion.update({ where: { id: policy.id }, data: { status: "PUBLISHED", approvedById: input.approverId, publishedAt: now, effectiveFrom } });
    await tx.adminApprovalRequest.update({ where: { id: request.id }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
    await audit(tx, input.approverId, "POLICY_PUBLISHED", published, {
      approvalRequestId: request.id,
      requestedById: request.requestedById,
      effectiveFrom: effectiveFrom.toISOString(),
      supersededVersion: current?.version ?? null,
    });
    return { policy: published, superseded: current?.id ?? null };
  }));
}

/** Another admin rejects, or the requester withdraws (cancel). Either way the version becomes REJECTED. */
export async function decideAgainst(input: { requestId: string; actorId: string; note: string; mode: "REJECT" | "CANCEL" }) {
  const note = (input.note ?? "").trim();
  if (note.length < 3) throw new HttpError(400, "Add a short note.", { code: "NOTE_REQUIRED" });
  return guarded(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${input.requestId} FOR UPDATE`;
    const request = await tx.adminApprovalRequest.findUnique({ where: { id: input.requestId } });
    if (!request || request.action !== "POLICY_PUBLISH") throw new HttpError(404, "Not found");
    if (request.status !== "PENDING") throw new HttpError(409, `This request is already ${request.status.toLowerCase()}.`, { code: "ALREADY_DECIDED" });
    if (input.mode === "CANCEL" && request.requestedById !== input.actorId) throw new HttpError(403, "Only the requesting admin can withdraw this request.", { code: "NOT_REQUESTER" });
    if (input.mode === "REJECT" && request.requestedById === input.actorId) throw new HttpError(403, "Withdraw your own request instead of rejecting it.", { code: "USE_CANCEL" });
    const roles = await rolesOf(tx, [input.actorId]);
    if (roles.get(input.actorId) !== "ADMIN") throw new HttpError(403, "Admin access required.", { code: "NOT_ADMIN" });
    const status = input.mode === "REJECT" ? "REJECTED" : "CANCELLED";
    await tx.adminApprovalRequest.update({ where: { id: request.id }, data: { status, decidedById: input.actorId, decidedAt: new Date(), decisionNote: note, openKey: null } });
    const policy = await tx.policyVersion.update({ where: { id: request.targetId }, data: { status: "REJECTED" } });
    await audit(tx, input.actorId, input.mode === "REJECT" ? "POLICY_REJECTED" : "POLICY_SUBMISSION_CANCELLED", policy, { approvalRequestId: request.id });
    return { policy, status };
  }));
}

// ---------- Readiness and enforcement ----------

/** Whether two-admin actions are possible at all (needs at least two ADMIN accounts). */
export async function twoAdminCapability() {
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  return { adminCount, available: adminCount >= 2 };
}

export async function readiness(at: Date = new Date()) {
  await expireStaleApprovalsQuietly();
  const [capability, domains] = await Promise.all([
    twoAdminCapability(),
    Promise.all(
      POLICY_DOMAINS.map(async (domain) => {
        const [current, upcoming, awaiting] = await Promise.all([
          resolvePolicy(domain, at),
          upcomingPolicy(domain, at),
          prisma.policyVersion.count({ where: { domain, status: "PENDING_APPROVAL" } }),
        ]);
        return {
          domain,
          current: current ? { id: current.id, version: current.version, effectiveFrom: current.effectiveFrom, payloadSha256: current.payloadSha256, pending: pendingFields(current.payload as Record<string, unknown>) } : null,
          upcoming: upcoming ? { id: upcoming.id, version: upcoming.version, effectiveFrom: upcoming.effectiveFrom } : null,
          awaitingApproval: awaiting,
        };
      })
    ),
  ]);
  const byDomain = new Map(domains.map((x) => [x.domain, x]));
  const features = (Object.keys(FEATURE_REQUIREMENTS) as GatedFeature[]).map((feature) => {
    const blockers: string[] = [];
    for (const req of FEATURE_REQUIREMENTS[feature]) {
      const cur = byDomain.get(req.domain)?.current;
      if (!cur) blockers.push(`${req.domain}: no published policy`);
      else for (const f of req.fields) if (cur.pending.includes(f)) blockers.push(`${req.domain}.${f}: PENDING`);
    }
    // Policies being complete never switches a feature on: activation is a separate, explicit step
    // that does not exist yet for any financial feature.
    return { feature, policiesComplete: blockers.length === 0, blockers, activated: false };
  });
  return { at, twoAdmin: capability, domains, features };
}

/**
 * Server-side gate for future financial features: refuses unless every required field of the policies
 * in force now is decided. Throws 409 POLICY_MISSING / POLICY_PENDING. (Activation is checked separately.)
 */
export async function requirePolicy(feature: GatedFeature, at: Date = new Date(), db: Tx | typeof prisma = prisma) {
  const resolved: Partial<Record<PolicyDomain, PolicyVersion>> = {};
  const blockers: string[] = [];
  for (const req of FEATURE_REQUIREMENTS[feature]) {
    const policy = resolved[req.domain] ?? (await resolvePolicy(req.domain, at, db)) ?? undefined;
    if (!policy) {
      blockers.push(`${req.domain}: no published policy`);
      continue;
    }
    resolved[req.domain] = policy;
    const payload = policy.payload as Record<string, unknown>;
    for (const f of req.fields) if (isPending(payload[f]) || payload[f] === undefined) blockers.push(`${req.domain}.${f}: PENDING`);
  }
  if (blockers.length) {
    const missing = blockers.some((b) => b.endsWith("no published policy"));
    throw new HttpError(409, "This feature needs business decisions that haven't been published yet.", { code: missing ? "POLICY_MISSING" : "POLICY_PENDING", blockers });
  }
  return resolved;
}

/** For actions that need two admins: refuses clearly in a one-admin environment. */
export async function requireTwoAdmins() {
  const cap = await twoAdminCapability();
  if (!cap.available) throw new HttpError(409, "This action needs a second admin to approve it, and only one admin account exists.", { code: "SECOND_ADMIN_REQUIRED", adminCount: cap.adminCount });
  return cap;
}

// ---------- Expiry ----------

/**
 * Marks one expired publication request EXPIRED and its policy REJECTED, with an audit row. Runs
 * under the same domain lock and row lock as approval, so an approval and an expiry of the same
 * request can never both win. Rows are never deleted. Returns true if this call expired it.
 */
export async function expireRequest(requestId: string, now: Date = new Date()) {
  const pre = await prisma.adminApprovalRequest.findUnique({ where: { id: requestId }, select: { targetId: true, action: true } });
  if (!pre || pre.action !== "POLICY_PUBLISH") return false;
  const policyRef = await prisma.policyVersion.findUnique({ where: { id: pre.targetId }, select: { domain: true } });
  if (!policyRef) return false;
  return guarded(() => prisma.$transaction(async (tx) => {
    await lockDomain(tx, policyRef.domain);
    await tx.$queryRaw`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const request = await tx.adminApprovalRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== "PENDING" || request.expiresAt.getTime() > now.getTime()) return false;
    await tx.adminApprovalRequest.update({ where: { id: request.id }, data: { status: "EXPIRED", decidedAt: now, decisionNote: "Expired before approval", openKey: null } });
    const policy = await tx.policyVersion.update({ where: { id: request.targetId }, data: { status: "REJECTED" } });
    await audit(tx, null, "POLICY_APPROVAL_EXPIRED", policy, { approvalRequestId: request.id, expiresAt: request.expiresAt.toISOString() });
    return true;
  }));
}

/** Expires every overdue publication request (the scheduled job; also run before approval reads). */
export async function expireStaleApprovals(now: Date = new Date()) {
  const due = await prisma.adminApprovalRequest.findMany({
    where: { action: "POLICY_PUBLISH", status: "PENDING", expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
  });
  let expired = 0;
  for (const r of due) if (await expireRequest(r.id, now)) expired++;
  return { checked: due.length, expired };
}

/** Best effort before reads: a failure here must not hide the approvals list. */
async function expireStaleApprovalsQuietly() {
  try {
    await expireStaleApprovals();
  } catch (err) {
    console.error("[POLICY] expiry run failed", err instanceof Error ? err.message : err);
  }
}

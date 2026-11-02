import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FranchisePartnerStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { canonicalSha256 } from "../utils/canonical-json.js";

/**
 * Franchise partners (Phase 5F-1). A user is a Franchise Admin only while the DATABASE says so:
 * a FranchisePartner row that is ACTIVE, inside its agreement dates, holding an ALLOCATED primary
 * allocation of its district, owned by a USER (never an ADMIN). There is no franchise role in the
 * session token, so nothing can be forged or go stale.
 */

type Tx = Prisma.TransactionClient;
export type PartnerContext = { partnerId: string; districtId: string; franchiseCode: string };

/** Why access was refused. NOT_A_PARTNER is the ordinary case for everyone else. */
export type AccessDenial =
  | "NOT_A_PARTNER"
  | "ADMIN_ACCOUNT"
  | "PARTNER_SUSPENDED"
  | "PARTNER_DEACTIVATED"
  | "PARTNER_EXPIRED"
  | "AGREEMENT_NOT_STARTED"
  | "AGREEMENT_ENDED"
  | "DISTRICT_NOT_ALLOCATED";

const DENIAL_MESSAGE: Record<AccessDenial, string> = {
  NOT_A_PARTNER: "This account isn't an active franchise partner.",
  ADMIN_ACCOUNT: "Admin accounts can't act as franchise partners.",
  PARTNER_SUSPENDED: "This franchise is suspended.",
  PARTNER_DEACTIVATED: "This franchise has been deactivated.",
  PARTNER_EXPIRED: "This franchise has expired.",
  AGREEMENT_NOT_STARTED: "This franchise agreement hasn't started yet.",
  AGREEMENT_ENDED: "This franchise agreement has ended.",
  DISTRICT_NOT_ALLOCATED: "This franchise doesn't hold its district allocation.",
};

const STATUS_DENIAL: Partial<Record<FranchisePartnerStatus, AccessDenial>> = {
  SUSPENDED: "PARTNER_SUSPENDED",
  DEACTIVATED: "PARTNER_DEACTIVATED",
  EXPIRED: "PARTNER_EXPIRED",
};

/**
 * The single access decision, read from the database on every request. Returns the partner's own
 * identifiers (the only ids partner handlers may use) or the reason for refusal.
 */
export async function resolvePartnerAccess(userId: string, now = new Date()): Promise<{ ok: true; partner: PartnerContext } | { ok: false; reason: AccessDenial; partnerId?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, franchisePartner: { select: { id: true, status: true, districtId: true, franchiseCode: true, agreementStartsAt: true, agreementEndsAt: true } } } });
  const p = user?.franchisePartner;
  if (!user || !p) return { ok: false, reason: "NOT_A_PARTNER" };
  if (user.role !== "USER") return { ok: false, reason: "ADMIN_ACCOUNT", partnerId: p.id };
  const statusDenial = STATUS_DENIAL[p.status];
  if (statusDenial) return { ok: false, reason: statusDenial, partnerId: p.id };
  if (now < p.agreementStartsAt) return { ok: false, reason: "AGREEMENT_NOT_STARTED", partnerId: p.id };
  if (now >= p.agreementEndsAt) return { ok: false, reason: "AGREEMENT_ENDED", partnerId: p.id };
  const allocated = await prisma.districtAllocation.count({ where: { districtId: p.districtId, partnerId: p.id, role: "PRIMARY", status: "ALLOCATED" } });
  if (!allocated) return { ok: false, reason: "DISTRICT_NOT_ALLOCATED", partnerId: p.id };
  return { ok: true, partner: { partnerId: p.id, districtId: p.districtId, franchiseCode: p.franchiseCode } };
}

export function denialError(reason: AccessDenial) {
  return new HttpError(403, DENIAL_MESSAGE[reason], { code: reason === "NOT_A_PARTNER" ? "NOT_A_FRANCHISE_PARTNER" : reason });
}

/** Refusals of an existing partner are recorded (ids only); ordinary non-partners are not. */
export async function auditDenial(userId: string, reason: AccessDenial, partnerId?: string, path?: string) {
  if (!partnerId) return;
  await prisma.auditLog.create({ data: { actorId: userId, action: "FRANCHISE_PARTNER_ACCESS_DENIED", target: partnerId, metadata: { reason, path: path ?? null } } }).catch(() => {});
}

/** The partner's own profile. Only ever called with the id resolved from the caller's account. */
export async function partnerProfile(ctx: PartnerContext) {
  const p = await prisma.franchisePartner.findUniqueOrThrow({
    where: { id: ctx.partnerId },
    select: {
      franchiseCode: true,
      status: true,
      agreementStartsAt: true,
      agreementEndsAt: true,
      activatedAt: true,
      attributionAllowed: true,
      payoutsPaused: true,
      user: { select: { name: true, email: true } },
      district: { select: { name: true, code: true, state: { select: { name: true } } } },
    },
  });
  return {
    franchiseCode: p.franchiseCode,
    status: p.status,
    ownerName: p.user.name,
    ownerEmail: p.user.email,
    district: p.district.name,
    districtCode: p.district.code,
    state: p.district.state.name,
    agreementStartsAt: p.agreementStartsAt,
    agreementEndsAt: p.agreementEndsAt,
    activatedAt: p.activatedAt,
    attributionAllowed: p.attributionAllowed,
    payoutsPaused: p.payoutsPaused,
  };
}

// ---------- Activation (no API route in 5F-1; called by the agreement flow once payment and agreement exist) ----------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const newFranchiseCode = () => `FR-${Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};

/**
 * Turns an application into an active franchise. Every precondition is re-checked inside the
 * transaction: AGREEMENT_PENDING, a PAID fee, an accepted agreement, the application's own unexpired
 * district RESERVATION, a USER (not ADMIN) owner with no franchise yet. The reservation becomes the
 * allocation in the same transaction, so a district can never end up with two partners.
 */
export async function activatePartner(input: { applicationId: string; actorId: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchiseApplication" WHERE "id" = ${input.applicationId} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, "Not found");
    const app = await tx.franchiseApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      select: { id: true, status: true, version: true, userId: true, districtId: true, applicationNo: true, user: { select: { role: true, franchisePartner: { select: { id: true } } } } },
    });
    const refuse = (code: string, message: string) => new HttpError(409, message, { code });
    if (app.status !== "AGREEMENT_PENDING") throw refuse("NOT_READY", `The application is "${app.status}", not awaiting activation.`);
    if (app.user.role !== "USER") throw refuse("ADMIN_ACCOUNT", "Admin accounts can't become franchise partners.");
    if (app.user.franchisePartner) throw refuse("ALREADY_PARTNER", "This account already has a franchise.");
    const paid = await tx.franchisePayment.count({ where: { applicationId: app.id, status: "PAID" } });
    if (!paid) throw refuse("FEE_NOT_PAID", "The franchise fee hasn't been paid.");
    const agreement = await tx.franchiseAgreement.findUnique({ where: { applicationId: app.id }, select: { acceptedAt: true, termMonths: true } });
    if (!agreement?.acceptedAt) throw refuse("AGREEMENT_NOT_ACCEPTED", "The agreement hasn't been accepted.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eta-district:${app.districtId}`}))`;
    const reservation = await tx.districtAllocation.findFirst({ where: { districtId: app.districtId, applicationId: app.id, role: "PRIMARY", status: "RESERVED" } });
    if (!reservation) throw refuse("NO_RESERVATION", "The district isn't reserved for this application.");
    if (reservation.reservedUntil && reservation.reservedUntil <= now) throw refuse("RESERVATION_EXPIRED", "The district reservation has expired.");

    let franchiseCode = newFranchiseCode();
    for (let i = 0; i < 5 && (await tx.franchisePartner.count({ where: { franchiseCode } })); i++) franchiseCode = newFranchiseCode();
    const partner = await tx.franchisePartner.create({
      data: { userId: app.userId, applicationId: app.id, franchiseCode, districtId: app.districtId, status: "ACTIVE", agreementStartsAt: now, agreementEndsAt: addMonths(now, agreement.termMonths), activatedAt: now },
    });
    const moved = await tx.districtAllocation.updateMany({ where: { id: reservation.id, status: "RESERVED" }, data: { status: "ALLOCATED", partnerId: partner.id, allocatedAt: now } });
    if (moved.count !== 1) throw refuse("STALE", "The district reservation changed — try again.");
    await tx.districtAllocationEvent.create({ data: { allocationId: reservation.id, districtId: app.districtId, fromStatus: "RESERVED", toStatus: "ALLOCATED", actorId: input.actorId, reason: "Franchise activated" } });
    await tx.franchisePartnerEvent.create({ data: { partnerId: partner.id, type: "ACTIVATED", toStatus: "ACTIVE", actorId: input.actorId, reason: "Payment and agreement complete" } });
    const done = await tx.franchiseApplication.updateMany({ where: { id: app.id, status: "AGREEMENT_PENDING", version: app.version }, data: { status: "ACTIVE_FRANCHISE", version: { increment: 1 } } });
    if (done.count !== 1) throw refuse("STALE", "The application changed — try again.");
    await tx.franchiseApplicationStatusHistory.create({
      data: { applicationId: app.id, fromStatus: "AGREEMENT_PENDING", toStatus: "ACTIVE_FRANCHISE", actorId: input.actorId, actorType: input.actorId ? "ADMIN" : "SYSTEM", applicantNote: "Your franchise is active" },
    });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "FRANCHISE_PARTNER_ACTIVATED", target: partner.id, metadata: { applicationNo: app.applicationNo, districtId: app.districtId, franchiseCode } } });
    return partner;
  });
}

// ---------- Admin: list, detail, status actions ----------

/** Admin reads and writes re-check the role in the database (the session token's role can be stale). */
async function requireAdmin(db: Tx | typeof prisma, actorId: string, lock = false) {
  const rows = lock
    ? await (db as Tx).$queryRaw<{ role: string }[]>`SELECT "role"::text AS "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`
    : [{ role: (await db.user.findUnique({ where: { id: actorId }, select: { role: true } }))?.role ?? "" }];
  if (rows[0]?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

export async function listPartners(actorId: string) {
  await requireAdmin(prisma, actorId);
  const rows = await prisma.franchisePartner.findMany({
    orderBy: { activatedAt: "desc" },
    take: 500,
    select: { id: true, franchiseCode: true, status: true, agreementStartsAt: true, agreementEndsAt: true, activatedAt: true, user: { select: { name: true } }, district: { select: { name: true, state: { select: { name: true } } } } },
  });
  return rows.map((r) => ({ id: r.id, franchiseCode: r.franchiseCode, status: r.status, ownerName: r.user.name, district: r.district.name, state: r.district.state.name, agreementStartsAt: r.agreementStartsAt, agreementEndsAt: r.agreementEndsAt, activatedAt: r.activatedAt }));
}

export async function partnerDetail(actorId: string, id: string) {
  await requireAdmin(prisma, actorId);
  const p = await prisma.franchisePartner.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      application: { select: { id: true, applicationNo: true } },
      district: { select: { name: true, code: true, state: { select: { name: true } } } },
      allocations: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, allocatedAt: true, suspendedAt: true, releasedAt: true } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, fromStatus: true, toStatus: true, actorId: true, reason: true, approvalRequestId: true, createdAt: true } },
    },
  });
  if (!p) throw new HttpError(404, "Not found");
  const requests = await prisma.adminApprovalRequest.findMany({
    where: { targetType: "FranchisePartner", targetId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, status: true, reason: true, payloadSha256: true, expiresAt: true, createdAt: true, decidedAt: true, decisionNote: true, requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } } },
  });
  await prisma.auditLog.create({ data: { actorId, action: "FRANCHISE_PARTNER_VIEWED", target: id, metadata: { franchiseCode: p.franchiseCode } } });
  return {
    id: p.id,
    franchiseCode: p.franchiseCode,
    status: p.status,
    owner: p.user,
    application: p.application,
    district: { name: p.district.name, code: p.district.code, state: p.district.state.name },
    agreementStartsAt: p.agreementStartsAt,
    agreementEndsAt: p.agreementEndsAt,
    activatedAt: p.activatedAt,
    suspendedAt: p.suspendedAt,
    deactivatedAt: p.deactivatedAt,
    allocations: p.allocations,
    events: p.events,
    requests,
  };
}

const reasonSchema = z.string().trim().min(10, "Give a reason of at least 10 characters").max(1000, "The reason is at most 1000 characters");
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};

/** Locks the partner row and checks its status hasn't moved since the admin looked. */
async function lockPartner(tx: Tx, id: string, expected: FranchisePartnerStatus) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchisePartner" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "Not found");
  const p = await tx.franchisePartner.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, districtId: true, franchiseCode: true } });
  if (p.status !== expected) throw new HttpError(409, `The franchise is ${p.status}, not ${expected} — reload and try again.`, { code: "STALE", status: p.status });
  return p;
}

/**
 * Protective suspension: one admin, immediate (a compromised or misbehaving franchise must be stoppable
 * at once). Access ends on the partner's next request; the district stays held (allocation SUSPENDED).
 */
export async function suspendPartner(actorId: string, id: string, input: unknown) {
  const { reason } = parse(z.object({ reason: reasonSchema }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdmin(tx, actorId, true);
    const p = await lockPartner(tx, id, "ACTIVE");
    await tx.franchisePartner.update({ where: { id }, data: { status: "SUSPENDED", suspendedAt: now } });
    const alloc = await tx.districtAllocation.findFirst({ where: { partnerId: id, districtId: p.districtId, role: "PRIMARY", status: "ALLOCATED" } });
    if (alloc) {
      await tx.districtAllocation.update({ where: { id: alloc.id }, data: { status: "SUSPENDED", suspendedAt: now } });
      await tx.districtAllocationEvent.create({ data: { allocationId: alloc.id, districtId: p.districtId, fromStatus: "ALLOCATED", toStatus: "SUSPENDED", actorId, reason } });
    }
    await tx.franchisePartnerEvent.create({ data: { partnerId: id, type: "SUSPENDED", fromStatus: "ACTIVE", toStatus: "SUSPENDED", actorId, reason } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_PARTNER_SUSPENDED", target: id, metadata: { franchiseCode: p.franchiseCode } } });
    return { id, status: "SUSPENDED" as const };
  });
}

/** Two-admin actions: reinstating a suspended franchise, or deactivating one. */
const PARTNER_ACTIONS = {
  REINSTATE: { approval: "PARTNER_REINSTATE", from: ["SUSPENDED"] },
  DEACTIVATE: { approval: "PARTNER_DEACTIVATE", from: ["ACTIVE", "SUSPENDED"] },
} as const satisfies Record<string, { approval: "PARTNER_REINSTATE" | "PARTNER_DEACTIVATE"; from: FranchisePartnerStatus[] }>;
type PartnerAction = keyof typeof PARTNER_ACTIONS;
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function requestPartnerAction(actorId: string, id: string, input: unknown) {
  const { action, reason } = parse(z.object({ action: z.enum(["REINSTATE", "DEACTIVATE"]), reason: reasonSchema }).strict(), input);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireAdmin(tx, actorId, true);
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchisePartner" WHERE "id" = ${id} FOR UPDATE`;
      if (!rows.length) throw new HttpError(404, "Not found");
      const p = await tx.franchisePartner.findUniqueOrThrow({ where: { id }, select: { status: true, franchiseCode: true } });
      if (!(PARTNER_ACTIONS[action].from as readonly FranchisePartnerStatus[]).includes(p.status)) {
        throw new HttpError(409, `A ${p.status} franchise can't be ${action === "REINSTATE" ? "reinstated" : "deactivated"}.`, { code: "INVALID_ACTION", status: p.status });
      }
      // A request that expired undecided would otherwise hold the open key forever.
      await tx.adminApprovalRequest.updateMany({ where: { openKey: `partner:${id}`, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", openKey: null } });
      const payload = { action, partnerId: id, fromStatus: p.status };
      const request = await tx.adminApprovalRequest.create({
        data: {
          action: PARTNER_ACTIONS[action].approval,
          targetType: "FranchisePartner",
          targetId: id,
          payload,
          payloadSha256: canonicalSha256(payload),
          reason,
          openKey: `partner:${id}`,
          requestedById: actorId,
          expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
        },
      });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_PARTNER_ACTION_REQUESTED", target: id, metadata: { requestId: request.id, action } } });
      return { id: request.id, action, status: request.status, payloadSha256: request.payloadSha256, expiresAt: request.expiresAt };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "This franchise already has an open request.", { code: "REQUEST_EXISTS" });
    throw err;
  }
}

/** A second admin approves the exact payload; the action executes in the same transaction. */
export async function approvePartnerAction(actorId: string, requestId: string, input: unknown) {
  const { expectedPayloadSha } = parse(z.object({ expectedPayloadSha: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdmin(tx, actorId, true);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
    if (!req || req.targetType !== "FranchisePartner" || !["PARTNER_REINSTATE", "PARTNER_DEACTIVATE"].includes(req.action)) throw new HttpError(404, "Not found");
    if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
    if (req.requestedById === actorId) throw new HttpError(403, "A different admin must approve this request.", { code: "SAME_ADMIN" });
    if (req.payloadSha256 !== expectedPayloadSha) throw new HttpError(409, "The request isn't the one you reviewed.", { code: "PAYLOAD_MISMATCH" });
    if (req.expiresAt <= now) throw new HttpError(409, "This request has expired.", { code: "EXPIRED" });
    const payload = req.payload as { action: PartnerAction; partnerId: string; fromStatus: FranchisePartnerStatus };
    const p = await lockPartner(tx, payload.partnerId, payload.fromStatus);
    await tx.adminApprovalRequest.update({ where: { id: requestId }, data: { status: "APPROVED", decidedById: actorId, decidedAt: now } });

    const alloc = await tx.districtAllocation.findFirst({ where: { partnerId: p.id, districtId: p.districtId, role: "PRIMARY", status: { in: ["ALLOCATED", "SUSPENDED"] } } });
    if (payload.action === "REINSTATE") {
      await tx.franchisePartner.update({ where: { id: p.id }, data: { status: "ACTIVE", suspendedAt: null } });
      if (alloc?.status === "SUSPENDED") {
        await tx.districtAllocation.update({ where: { id: alloc.id }, data: { status: "ALLOCATED", suspendedAt: null } });
        await tx.districtAllocationEvent.create({ data: { allocationId: alloc.id, districtId: p.districtId, fromStatus: "SUSPENDED", toStatus: "ALLOCATED", actorId, approvalRequestId: requestId, reason: req.reason } });
      }
      await tx.franchisePartnerEvent.create({ data: { partnerId: p.id, type: "REINSTATED", fromStatus: p.status, toStatus: "ACTIVE", actorId, approvalRequestId: requestId, reason: req.reason } });
    } else {
      // Deactivation ends partner access; the district stays held (SUSPENDED) until a separate, reviewed
      // district release — never freed as a side effect.
      await tx.franchisePartner.update({ where: { id: p.id }, data: { status: "DEACTIVATED", deactivatedAt: now, ...(p.status === "ACTIVE" ? { suspendedAt: now } : {}) } });
      if (alloc?.status === "ALLOCATED") {
        await tx.districtAllocation.update({ where: { id: alloc.id }, data: { status: "SUSPENDED", suspendedAt: now } });
        await tx.districtAllocationEvent.create({ data: { allocationId: alloc.id, districtId: p.districtId, fromStatus: "ALLOCATED", toStatus: "SUSPENDED", actorId, approvalRequestId: requestId, reason: req.reason } });
      }
      await tx.franchisePartnerEvent.create({ data: { partnerId: p.id, type: "DEACTIVATED", fromStatus: p.status, toStatus: "DEACTIVATED", actorId, approvalRequestId: requestId, reason: req.reason } });
    }
    await tx.adminApprovalRequest.update({ where: { id: requestId }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_PARTNER_ACTION_APPROVED", target: p.id, metadata: { requestId, action: payload.action, requestedById: req.requestedById } } });
    return { id: p.id, status: payload.action === "REINSTATE" ? "ACTIVE" : "DEACTIVATED" };
  });
}

/** The other admin rejects, or the requester cancels; either way nothing changes on the franchise. */
export async function closePartnerAction(actorId: string, requestId: string, mode: "reject" | "cancel", input: unknown) {
  const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdmin(tx, actorId, true);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
    if (!req || req.targetType !== "FranchisePartner") throw new HttpError(404, "Not found");
    if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
    if (mode === "cancel" && req.requestedById !== actorId) throw new HttpError(403, "Only the admin who asked can cancel this request.", { code: "NOT_REQUESTER" });
    if (mode === "reject" && req.requestedById === actorId) throw new HttpError(403, "Cancel your own request instead of rejecting it.", { code: "SAME_ADMIN" });
    await tx.adminApprovalRequest.update({
      where: { id: requestId },
      data: { status: mode === "reject" ? "REJECTED" : "CANCELLED", openKey: null, decidedAt: now, decisionNote: note ?? null, ...(mode === "reject" ? { decidedById: actorId } : {}) },
    });
    await tx.auditLog.create({ data: { actorId, action: mode === "reject" ? "FRANCHISE_PARTNER_ACTION_REJECTED" : "FRANCHISE_PARTNER_ACTION_CANCELLED", target: req.targetId, metadata: { requestId } } });
    return { id: requestId, status: mode === "reject" ? "REJECTED" : "CANCELLED" };
  });
}

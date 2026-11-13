import { z } from "zod";
import type { FranchiseApplicationStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { canonicalSha256 } from "../utils/canonical-json.js";
import { requireAdminRead } from "./franchise-admin-guard.js";

/**
 * State-level franchise exclusivity: one PRIMARY franchise per Indian state (IndiaState.id — the official
 * state record, never a typed name). A StateAllocation RESERVED, ALLOCATED or SUSPENDED holds its state; a
 * partial unique index makes a second holder impossible, and every change takes the state's advisory lock.
 *
 * - An application on its own never holds or closes a state. An admin may reserve a state for an
 *   APPROVED application (temporary, with an end date); only activation turns it ALLOCATED (CLOSED).
 * - Suspension and deactivation keep the state held. Reopening needs a two-admin STATE_RELEASE with a
 *   reason, and only when the franchise holding it is deactivated or expired.
 * - Rejected and withdrawn applications never hold a state.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const HOLDING = ["RESERVED", "ALLOCATED", "SUSPENDED"] as const;
const PIPELINE: FranchiseApplicationStatus[] = ["APPROVED", "PAYMENT_PENDING", "AGREEMENT_PENDING"];
const IN_REVIEW: FranchiseApplicationStatus[] = ["APPLICATION_SUBMITTED", "UNDER_REVIEW", "INTERVIEW_DISCUSSION"];
const MAX_RESERVATION_DAYS = 90;
const DEFAULT_RESERVATION_DAYS = 30;
const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The admin-facing workflow status of a state (one of the eight agreed states). */
export type StateWorkflowStatus =
  | "AVAILABLE"
  | "APPLICATION_UNDER_REVIEW"
  | "APPROVED_AWAITING_PAYMENT"
  | "PAYMENT_VERIFIED_AWAITING_AGREEMENT"
  | "AGREEMENT_PENDING"
  | "ACTIVATED_CLOSED"
  | "SUSPENDED"
  | "REOPENED_AVAILABLE";

/** What the public sees: open for applications, temporarily reserved, or closed (has a franchise). */
export type PublicAvailability = "AVAILABLE" | "RESERVED" | "CLOSED";

export const lockState = (tx: Tx, stateId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eta-state:${stateId}`}))`;

/**
 * Allocations that hold a state right now: ALLOCATED or SUSPENDED, or RESERVED and not yet past its end
 * date. An expired reservation holds nothing (it is released, with an audit entry, the next time the
 * state is changed under its lock — see expireReservations).
 */
export const activeHoldWhere = (now = new Date()): Prisma.StateAllocationWhereInput => ({
  role: "PRIMARY",
  OR: [{ status: { in: ["ALLOCATED", "SUSPENDED"] } }, { status: "RESERVED", OR: [{ reservedUntil: null }, { reservedUntil: { gt: now } }] }],
});

/** The allocation currently holding a state (reserved and unexpired, allocated or suspended), if any. */
export function holdingAllocation(db: Db, stateId: string, now = new Date()) {
  return db.stateAllocation.findFirst({ where: { stateId, ...activeHoldWhere(now) } });
}

/**
 * Releases the state's expired reservations. Call it inside a transaction that holds the state's lock,
 * before creating a new hold (the partial unique index still counts an expired RESERVED row).
 */
export async function expireReservations(tx: Tx, stateId: string, now = new Date()) {
  const expired = await tx.stateAllocation.findMany({ where: { stateId, role: "PRIMARY", status: "RESERVED", reservedUntil: { lte: now } } });
  for (const r of expired) {
    await tx.stateAllocation.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: "Reservation expired" } });
    await tx.stateAllocationEvent.create({ data: { allocationId: r.id, stateId, fromStatus: "RESERVED", toStatus: "RELEASED", actorId: null, reason: "Reservation expired" } });
    await tx.auditLog.create({ data: { actorId: null, action: "FRANCHISE_STATE_RESERVATION_EXPIRED", target: r.id, metadata: { stateId, applicationId: r.applicationId, reservedUntil: r.reservedUntil?.toISOString() ?? null } } });
  }
  return expired.length;
}

/** Public availability of each state, from the allocations only (never from applications). */
export async function publicStateAvailability(stateIds?: string[]) {
  const rows = await prisma.stateAllocation.findMany({
    where: { ...activeHoldWhere(), ...(stateIds ? { stateId: { in: stateIds } } : {}) },
    select: { stateId: true, status: true },
  });
  const map = new Map<string, PublicAvailability>();
  for (const r of rows) map.set(r.stateId, r.status === "RESERVED" ? "RESERVED" : "CLOSED");
  return map;
}

// ---------- Admin: availability, history ----------

function workflowStatus(holding: { status: string } | null, holderAppStatus: FranchiseApplicationStatus | null, agreementIssued: boolean, counts: Record<string, number>, everReleased: boolean): StateWorkflowStatus {
  if (holding?.status === "ALLOCATED") return "ACTIVATED_CLOSED";
  if (holding?.status === "SUSPENDED") return "SUSPENDED";
  if (holding?.status === "RESERVED" || holderAppStatus) {
    if (holderAppStatus === "AGREEMENT_PENDING") return agreementIssued ? "AGREEMENT_PENDING" : "PAYMENT_VERIFIED_AWAITING_AGREEMENT";
    return "APPROVED_AWAITING_PAYMENT";
  }
  if (IN_REVIEW.some((s) => (counts[s] ?? 0) > 0)) return "APPLICATION_UNDER_REVIEW";
  return everReleased ? "REOPENED_AVAILABLE" : "AVAILABLE";
}

export async function adminStateAvailability(actorId: string) {
  await requireAdminRead(actorId);
  const [states, holdings, released, apps] = await Promise.all([
    prisma.indiaState.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true, isActive: true } }),
    prisma.stateAllocation.findMany({
      where: activeHoldWhere(),
      select: { id: true, stateId: true, status: true, reservedUntil: true, allocatedAt: true, suspendedAt: true, application: { select: { id: true, applicationNo: true, status: true, agreement: { select: { id: true } } } }, partner: { select: { id: true, franchiseCode: true, status: true } } },
    }),
    // "Reopened" means franchise rights were released (two-admin); an ended reservation is not a reopening.
    prisma.stateAllocation.findMany({ where: { status: "RELEASED", partnerId: { not: null } }, select: { stateId: true }, distinct: ["stateId"] }),
    prisma.franchiseApplication.groupBy({ by: ["stateId", "status"], _count: true }),
  ]);
  const holdingByState = new Map(holdings.map((h) => [h.stateId, h]));
  const releasedStates = new Set(released.map((r) => r.stateId));
  const countsByState = new Map<string, Record<string, number>>();
  for (const a of apps) {
    const c = countsByState.get(a.stateId) ?? {};
    c[a.status] = a._count;
    countsByState.set(a.stateId, c);
  }
  // An approved-or-later application without a reservation still marks the state as in the pipeline.
  const pipeline = await prisma.franchiseApplication.findMany({ where: { status: { in: PIPELINE } }, select: { id: true, stateId: true, applicationNo: true, status: true, agreement: { select: { id: true } } } });
  const pipelineByState = new Map(pipeline.map((p) => [p.stateId, p]));

  return states.map((s) => {
    const h = holdingByState.get(s.id) ?? null;
    const holderApp = h?.application ?? pipelineByState.get(s.id) ?? null;
    const counts = countsByState.get(s.id) ?? {};
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      isActive: s.isActive,
      status: workflowStatus(h, holderApp && PIPELINE.includes(holderApp.status) ? holderApp.status : null, Boolean(holderApp?.agreement), counts, releasedStates.has(s.id)),
      holding: h ? { allocationId: h.id, status: h.status, reservedUntil: h.reservedUntil, allocatedAt: h.allocatedAt, suspendedAt: h.suspendedAt } : null,
      application: holderApp ? { id: holderApp.id, applicationNo: holderApp.applicationNo, status: holderApp.status } : null,
      partner: h?.partner ? { id: h.partner.id, franchiseCode: h.partner.franchiseCode, status: h.partner.status } : null,
      applications: counts,
    };
  });
}

export async function stateHistory(actorId: string, stateId: string) {
  await requireAdminRead(actorId);
  const state = await prisma.indiaState.findUnique({ where: { id: stateId }, select: { id: true, name: true, code: true } });
  if (!state) throw new HttpError(404, "Not found");
  const [allocations, applications] = await Promise.all([
    prisma.stateAllocation.findMany({ where: { stateId }, orderBy: { createdAt: "asc" }, include: { events: { orderBy: { createdAt: "asc" } }, partner: { select: { franchiseCode: true, status: true } }, application: { select: { applicationNo: true } } } }),
    prisma.franchiseApplication.findMany({ where: { stateId }, orderBy: { submittedAt: "asc" }, select: { id: true, applicationNo: true, applicantName: true, status: true, submittedAt: true, history: { orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, actorType: true, createdAt: true } } } }),
  ]);
  const targets = [stateId, ...allocations.map((a) => a.id), ...applications.map((a) => a.id), ...allocations.flatMap((a) => (a.partnerId ? [a.partnerId] : []))];
  const audit = await prisma.auditLog.findMany({ where: { target: { in: targets } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, action: true, actorId: true, target: true, createdAt: true } });
  return { state, allocations, applications, audit };
}

// ---------- Admin: reservation ----------

const reasonSchema = z.string().trim().min(10, "Give a reason of at least 10 characters").max(500);
const reserveSchema = z.object({ reason: reasonSchema, days: z.number().int().min(1).max(MAX_RESERVATION_DAYS).default(DEFAULT_RESERVATION_DAYS) }).strict();
const reasonOnly = z.object({ reason: reasonSchema }).strict();
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};

/** The acting admin, re-read and locked inside the transaction (a demoted admin can't finish an action). */
async function requireAdminInTx(tx: Tx, actorId: string) {
  const rows = await tx.$queryRaw<{ role: string }[]>`SELECT "role"::text AS "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`;
  if (rows[0]?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

/** Temporarily reserves the application's state (APPROVED or later in the pipeline). Never closes it. */
export async function reserveState(actorId: string, applicationId: string, input: unknown) {
  const { reason, days } = parse(reserveSchema, input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const app = await tx.franchiseApplication.findUnique({ where: { id: applicationId }, select: { id: true, stateId: true, status: true, applicationNo: true } });
    if (!app) throw new HttpError(404, "Not found");
    if (!PIPELINE.includes(app.status)) throw new HttpError(409, "Only an approved application can have its state reserved.", { code: "NOT_APPROVED" });
    await lockState(tx, app.stateId);
    await expireReservations(tx, app.stateId, now);
    const held = await holdingAllocation(tx, app.stateId, now);
    if (held) throw new HttpError(409, held.applicationId === app.id ? "This state is already reserved for this application." : "This state is already held.", { code: "STATE_HELD" });
    const allocation = await tx.stateAllocation.create({
      data: { stateId: app.stateId, status: "RESERVED", applicationId: app.id, reservedAt: now, reservedUntil: new Date(now.getTime() + days * 86_400_000), createdById: actorId },
    });
    await tx.stateAllocationEvent.create({ data: { allocationId: allocation.id, stateId: app.stateId, fromStatus: null, toStatus: "RESERVED", actorId, reason } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_RESERVED", target: allocation.id, metadata: { stateId: app.stateId, applicationId: app.id, applicationNo: app.applicationNo, days } } });
    return { id: allocation.id, status: "RESERVED" as const, reservedUntil: allocation.reservedUntil };
  });
}

/** Ends a temporary reservation (no franchise rights exist yet). One admin, with a reason; audited. */
export async function releaseReservation(actorId: string, applicationId: string, input: unknown) {
  const { reason } = parse(reasonOnly, input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const app = await tx.franchiseApplication.findUnique({ where: { id: applicationId }, select: { id: true, stateId: true } });
    if (!app) throw new HttpError(404, "Not found");
    await lockState(tx, app.stateId);
    const r = await tx.stateAllocation.findFirst({ where: { applicationId: app.id, status: "RESERVED" } });
    if (!r) throw new HttpError(409, "There's no reservation for this application.", { code: "NO_RESERVATION" });
    await tx.stateAllocation.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: reason } });
    await tx.stateAllocationEvent.create({ data: { allocationId: r.id, stateId: app.stateId, fromStatus: "RESERVED", toStatus: "RELEASED", actorId, reason } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_RESERVATION_RELEASED", target: r.id, metadata: { stateId: app.stateId, applicationId: app.id } } });
    return { id: r.id, status: "RELEASED" as const };
  });
}

/** Releases a withdrawn or rejected application's reservation, inside the caller's transaction. */
export async function releaseReservationFor(tx: Tx, applicationId: string, actorId: string | null, reason: string, now = new Date()) {
  const r = await tx.stateAllocation.findFirst({ where: { applicationId, status: "RESERVED" } });
  if (!r) return null;
  await lockState(tx, r.stateId);
  await tx.stateAllocation.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: reason } });
  await tx.stateAllocationEvent.create({ data: { allocationId: r.id, stateId: r.stateId, fromStatus: "RESERVED", toStatus: "RELEASED", actorId, reason } });
  return r.id;
}

// ---------- Admin: two-admin state release (reopen) ----------

/** A held state can be reopened only when the franchise holding it no longer has rights. */
async function releasable(tx: Tx, stateId: string, now: Date) {
  const h = await tx.stateAllocation.findFirst({ where: { stateId, role: "PRIMARY", status: { in: ["ALLOCATED", "SUSPENDED"] } }, include: { partner: { select: { id: true, status: true, agreementEndsAt: true, franchiseCode: true } } } });
  if (!h) throw new HttpError(409, "This state isn't held by a franchise, so there's nothing to reopen.", { code: "NOT_HELD" });
  const p = h.partner;
  const ended = p && (p.status === "DEACTIVATED" || p.status === "EXPIRED" || p.agreementEndsAt <= now);
  if (!ended) {
    throw new HttpError(409, "The franchise holding this state still has active or suspended rights. Deactivate it first (two-admin action); a suspension never reopens a state.", { code: "FRANCHISE_RIGHTS_ACTIVE", partnerStatus: p?.status ?? null });
  }
  return h;
}

export async function requestStateRelease(actorId: string, stateId: string, input: unknown) {
  const { reason } = parse(reasonOnly, input);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      if (!(await tx.indiaState.findUnique({ where: { id: stateId }, select: { id: true } }))) throw new HttpError(404, "Not found");
      await lockState(tx, stateId);
      const h = await releasable(tx, stateId, now);
      await tx.adminApprovalRequest.updateMany({ where: { openKey: `state:${stateId}`, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", openKey: null } });
      const payload = { action: "STATE_RELEASE", stateId, allocationId: h.id, partnerId: h.partnerId, fromStatus: h.status };
      const request = await tx.adminApprovalRequest.create({
        data: { action: "STATE_RELEASE", targetType: "IndiaState", targetId: stateId, payload, payloadSha256: canonicalSha256(payload), reason, openKey: `state:${stateId}`, requestedById: actorId, expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS) },
      });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_RELEASE_REQUESTED", target: stateId, metadata: { requestId: request.id, allocationId: h.id } } });
      return { id: request.id, status: request.status, payloadSha256: request.payloadSha256, expiresAt: request.expiresAt };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "This state already has an open reopen request.", { code: "REQUEST_EXISTS" });
    throw err;
  }
}

export async function listStateReleaseRequests(actorId: string) {
  await requireAdminRead(actorId);
  return prisma.adminApprovalRequest.findMany({ where: { action: "STATE_RELEASE" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, targetId: true, status: true, reason: true, payloadSha256: true, requestedById: true, decidedById: true, createdAt: true, expiresAt: true, decidedAt: true } });
}

/** A second, different admin approves the exact request; the state is released in the same transaction. */
export async function approveStateRelease(actorId: string, requestId: string, input: unknown) {
  const { expectedPayloadSha } = parse(z.object({ expectedPayloadSha: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
    if (!req || req.action !== "STATE_RELEASE" || req.targetType !== "IndiaState") throw new HttpError(404, "Not found");
    if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
    if (req.requestedById === actorId) throw new HttpError(403, "A different admin must approve this request.", { code: "SAME_ADMIN" });
    if (req.payloadSha256 !== expectedPayloadSha) throw new HttpError(409, "The request isn't the one you reviewed.", { code: "PAYLOAD_MISMATCH" });
    if (req.expiresAt <= now) throw new HttpError(409, "This request has expired.", { code: "EXPIRED" });
    const payload = req.payload as { stateId: string; allocationId: string };
    await lockState(tx, payload.stateId);
    const h = await releasable(tx, payload.stateId, now);
    if (h.id !== payload.allocationId) throw new HttpError(409, "The state's allocation changed since this request was made.", { code: "STALE" });
    await tx.adminApprovalRequest.update({ where: { id: requestId }, data: { status: "APPROVED", decidedById: actorId, decidedAt: now } });
    await tx.stateAllocation.update({ where: { id: h.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: req.reason, approvalRequestId: requestId } });
    await tx.stateAllocationEvent.create({ data: { allocationId: h.id, stateId: h.stateId, fromStatus: h.status, toStatus: "RELEASED", actorId, approvalRequestId: requestId, reason: req.reason } });
    await tx.adminApprovalRequest.update({ where: { id: requestId }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STATE_RELEASED", target: h.stateId, metadata: { requestId, allocationId: h.id, requestedById: req.requestedById, approvedById: actorId } } });
    return { stateId: h.stateId, status: "RELEASED" as const };
  });
}

/** The other admin rejects, or the requester cancels; the state is unchanged either way. */
export async function closeStateRelease(actorId: string, requestId: string, mode: "reject" | "cancel", input: unknown) {
  const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
    if (!req || req.action !== "STATE_RELEASE") throw new HttpError(404, "Not found");
    if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
    if (mode === "cancel" && req.requestedById !== actorId) throw new HttpError(403, "Only the admin who asked can cancel this request.", { code: "NOT_REQUESTER" });
    if (mode === "reject" && req.requestedById === actorId) throw new HttpError(403, "Cancel your own request instead of rejecting it.", { code: "SAME_ADMIN" });
    await tx.adminApprovalRequest.update({ where: { id: requestId }, data: { status: mode === "reject" ? "REJECTED" : "CANCELLED", openKey: null, decidedAt: now, decisionNote: note ?? null, ...(mode === "reject" ? { decidedById: actorId } : {}) } });
    await tx.auditLog.create({ data: { actorId, action: mode === "reject" ? "FRANCHISE_STATE_RELEASE_REJECTED" : "FRANCHISE_STATE_RELEASE_CANCELLED", target: req.targetId, metadata: { requestId } } });
    return { id: requestId, status: mode === "reject" ? "REJECTED" : "CANCELLED" };
  });
}

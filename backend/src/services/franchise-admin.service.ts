import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { requireAdminInTx, requireAdminRead } from "./franchise-admin-guard.js";
import { activeHoldWhere } from "./franchise-state.service.js";
import { canonicalSha256 } from "../utils/canonical-json.js";

/**
 * The Franchise Management control centre for admins: an overview built only from existing records,
 * admin-only student-to-franchise assignments, and the franchise audit history. Every read re-checks the
 * ADMIN role in the database; every write re-checks it inside its transaction and is audited.
 */

const PAGE_SIZE = 25;
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};
const reasonSchema = z.string().trim().min(10, "Give a reason of at least 10 characters").max(500, "The reason is at most 500 characters");

/** Systems that don't exist yet — shown as unavailable, never as figures or statuses. */
export const NOT_IMPLEMENTED_MESSAGE = "Not available until the relevant system is implemented.";
export const UNAVAILABLE_SYSTEMS = [
  { key: "feePayment", label: "Franchise fee payment verification" },
  { key: "agreement", label: "Signed franchise agreements" },
  { key: "esign", label: "E-signing" },
  { key: "payouts", label: "Franchise earnings and payouts" },
] as const;

// ---------- Overview ----------

export async function franchiseOverview(actorId: string) {
  await requireAdminRead(actorId);
  const now = new Date();
  const [states, holds, apps, partners, tickets, reopen, partnerRequests, assignmentRequests] = await Promise.all([
    prisma.indiaState.findMany({ select: { id: true, isActive: true } }),
    prisma.stateAllocation.findMany({ where: activeHoldWhere(now), select: { stateId: true, status: true } }),
    prisma.franchiseApplication.groupBy({ by: ["status"], _count: true }),
    prisma.franchisePartner.groupBy({ by: ["status"], _count: true }),
    prisma.supportTicket.groupBy({ by: ["status"], where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: true }),
    prisma.adminApprovalRequest.count({ where: { action: "STATE_RELEASE", status: "PENDING", expiresAt: { gt: now } } }),
    prisma.adminApprovalRequest.count({ where: { targetType: "FranchisePartner", status: "PENDING", expiresAt: { gt: now } } }),
    prisma.adminApprovalRequest.count({ where: { action: { in: ["STUDENT_REASSIGN", "STUDENT_ASSIGNMENT_END"] }, status: "PENDING", expiresAt: { gt: now } } }),
  ]);
  const holdByState = new Map(holds.map((h) => [h.stateId, h.status]));
  const reserved = states.filter((s) => holdByState.get(s.id) === "RESERVED").length;
  const closed = states.filter((s) => ["ALLOCATED", "SUSPENDED"].includes(holdByState.get(s.id) ?? "")).length;
  const count = <T extends { _count: number }>(rows: T[], pick: (r: T) => string) => Object.fromEntries(rows.map((r) => [pick(r), r._count])) as Record<string, number>;
  const partnersByStatus = count(partners, (r) => r.status);
  const ticketsByStatus = count(tickets, (r) => r.status);
  return {
    states: { total: states.length, enabled: states.filter((s) => s.isActive).length, available: states.length - reserved - closed, reserved, closed },
    applications: count(apps, (r) => r.status),
    partners: { active: partnersByStatus.ACTIVE ?? 0, suspended: partnersByStatus.SUSPENDED ?? 0, deactivated: partnersByStatus.DEACTIVATED ?? 0, expired: partnersByStatus.EXPIRED ?? 0 },
    tickets: { open: ticketsByStatus.OPEN ?? 0, inProgress: ticketsByStatus.IN_PROGRESS ?? 0 },
    pending: { reopenRequests: reopen, partnerRequests, assignmentRequests },
    systems: UNAVAILABLE_SYSTEMS.map((s) => ({ ...s, available: false as const, message: NOT_IMPLEMENTED_MESSAGE })),
  };
}

// ---------- Student assignments ----------

const assignmentListSchema = z.object({
  status: z.enum(["ACTIVE", "ENDED"]).optional(),
  partnerId: z.string().min(1).max(40).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** Student-to-franchise links. Only the student's name and account email are shown (no phone, address, documents). */
export async function listAssignments(actorId: string, query: unknown) {
  await requireAdminRead(actorId);
  const f = parse(assignmentListSchema, query);
  const where: Prisma.FranchiseStudentWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.partnerId ? { partnerId: f.partnerId } : {}),
    ...(f.q
      ? { OR: [{ student: { name: { contains: f.q, mode: "insensitive" } } }, { student: { email: { contains: f.q, mode: "insensitive" } } }, { partner: { franchiseCode: { contains: f.q, mode: "insensitive" } } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.franchiseStudent.count({ where }),
    prisma.franchiseStudent.findMany({
      where,
      orderBy: [{ status: "asc" }, { startsAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, status: true, source: true, startsAt: true, endsAt: true, endReason: true,
        student: { select: { id: true, name: true, email: true } },
        partner: { select: { id: true, franchiseCode: true, status: true, district: { select: { state: { select: { name: true } } } } } },
      },
    }),
  ]);
  return {
    total, page: f.page, pageSize: PAGE_SIZE,
    assignments: rows.map((r) => ({
      id: r.id, status: r.status, source: r.source, startsAt: r.startsAt, endsAt: r.endsAt, endReason: r.endReason,
      student: r.student,
      partner: { id: r.partner.id, franchiseCode: r.partner.franchiseCode, status: r.partner.status, state: r.partner.district.state.name },
    })),
  };
}

/** Locks the link row and checks it is still ACTIVE with the partner the admin saw. */
async function lockActiveLink(tx: Prisma.TransactionClient, linkId: string, expectedPartnerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchiseStudent" WHERE "id" = ${linkId} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "Not found");
  const link = await tx.franchiseStudent.findUniqueOrThrow({ where: { id: linkId }, include: { partner: { select: { franchiseCode: true } } } });
  if (link.status !== "ACTIVE") throw new HttpError(409, "This assignment has already ended.", { code: "NOT_ACTIVE" });
  if (link.partnerId !== expectedPartnerId) throw new HttpError(409, "This assignment changed since you opened it — reload and try again.", { code: "STALE" });
  return link;
}

const reassignSchema = z.object({ targetPartnerId: z.string().min(1).max(40), expectedPartnerId: z.string().min(1).max(40), reason: reasonSchema }).strict();
const REASSIGN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything a reassignment needs, checked again at approval time: the target must be an ACTIVE partner
 * inside its agreement that holds its state; the student must be an ordinary (USER) account that isn't the
 * target franchise's owner.
 */
async function checkReassignment(tx: Prisma.TransactionClient, studentUserId: string, targetPartnerId: string, now: Date) {
  const target = await tx.franchisePartner.findUnique({ where: { id: targetPartnerId }, select: { id: true, status: true, userId: true, franchiseCode: true, agreementEndsAt: true } });
  if (!target) throw new HttpError(404, "Target franchise not found", { code: "TARGET_NOT_FOUND" });
  if (target.status !== "ACTIVE" || target.agreementEndsAt <= now) throw new HttpError(409, "The target franchise isn't active.", { code: "TARGET_NOT_ACTIVE" });
  const holds = await tx.stateAllocation.count({ where: { partnerId: target.id, role: "PRIMARY", status: "ALLOCATED" } });
  if (!holds) throw new HttpError(409, "The target franchise doesn't hold its state allocation.", { code: "TARGET_NOT_ALLOCATED" });
  const student = await tx.user.findUnique({ where: { id: studentUserId }, select: { id: true, role: true } });
  if (!student || student.role !== "USER") throw new HttpError(409, "Only ordinary student accounts can be assigned to a franchise.", { code: "INVALID_STUDENT" });
  if (student.id === target.userId) throw new HttpError(409, "A franchise owner can't be their own franchise's student.", { code: "INVALID_STUDENT" });
  return target;
}

/**
 * Step 1 of a two-admin reassignment: one admin asks, with a mandatory reason. Nothing moves yet. One open
 * request (reassignment or end) per student link (openKey); requests expire after 7 days.
 */
export async function requestReassignment(actorId: string, linkId: string, input: unknown) {
  const { targetPartnerId, expectedPartnerId, reason } = parse(reassignSchema, input);
  if (targetPartnerId === expectedPartnerId) throw new HttpError(400, "Choose a different franchise.", { code: "SAME_PARTNER" });
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const link = await lockActiveLink(tx, linkId, expectedPartnerId);
      const target = await checkReassignment(tx, link.studentUserId, targetPartnerId, now);
      const openKey = `student-link:${link.id}`;
      await tx.adminApprovalRequest.updateMany({ where: { openKey, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", openKey: null } });
      const payload = { action: "STUDENT_REASSIGN", linkId: link.id, studentUserId: link.studentUserId, fromPartnerId: link.partnerId, toPartnerId: target.id };
      const request = await tx.adminApprovalRequest.create({
        data: { action: "STUDENT_REASSIGN", targetType: "FranchiseStudent", targetId: link.id, payload, payloadSha256: canonicalSha256(payload), reason, openKey, requestedById: actorId, expiresAt: new Date(now.getTime() + REASSIGN_TTL_MS) },
      });
      await tx.auditLog.create({
        data: { actorId, action: "FRANCHISE_STUDENT_REASSIGN_REQUESTED", target: link.studentUserId, metadata: { requestId: request.id, linkId: link.id, fromPartnerId: link.partnerId, fromFranchiseCode: link.partner.franchiseCode, toPartnerId: target.id, toFranchiseCode: target.franchiseCode, reason } },
      });
      return { id: request.id, status: request.status, payloadSha256: request.payloadSha256, expiresAt: request.expiresAt };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "This student already has an open request.", { code: "REQUEST_EXISTS" });
    throw err;
  }
}

const endSchema = z.object({ expectedPartnerId: z.string().min(1).max(40), reason: reasonSchema }).strict();

/**
 * Step 1 of a two-admin END: one admin asks, with a mandatory reason; nothing changes yet. Shares the
 * one-open-request-per-link key with reassignment, so a link can't have both pending at once.
 */
export async function requestAssignmentEnd(actorId: string, linkId: string, input: unknown) {
  const { expectedPartnerId, reason } = parse(endSchema, input);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await requireAdminInTx(tx, actorId);
      const link = await lockActiveLink(tx, linkId, expectedPartnerId);
      const openKey = `student-link:${link.id}`;
      await tx.adminApprovalRequest.updateMany({ where: { openKey, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", openKey: null } });
      const payload = { action: "STUDENT_ASSIGNMENT_END", linkId: link.id, studentUserId: link.studentUserId, fromPartnerId: link.partnerId };
      const request = await tx.adminApprovalRequest.create({
        data: { action: "STUDENT_ASSIGNMENT_END", targetType: "FranchiseStudent", targetId: link.id, payload, payloadSha256: canonicalSha256(payload), reason, openKey, requestedById: actorId, expiresAt: new Date(now.getTime() + REASSIGN_TTL_MS) },
      });
      await tx.auditLog.create({
        data: { actorId, action: "FRANCHISE_STUDENT_END_REQUESTED", target: link.studentUserId, metadata: { requestId: request.id, linkId: link.id, fromPartnerId: link.partnerId, fromFranchiseCode: link.partner.franchiseCode, reason } },
      });
      return { id: request.id, status: request.status, payloadSha256: request.payloadSha256, expiresAt: request.expiresAt };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "This student already has an open request.", { code: "REQUEST_EXISTS" });
    throw err;
  }
}

const ASSIGNMENT_ACTIONS = ["STUDENT_REASSIGN", "STUDENT_ASSIGNMENT_END"] as const;
type AssignmentPayload = { action: (typeof ASSIGNMENT_ACTIONS)[number]; linkId: string; studentUserId: string; fromPartnerId: string; toPartnerId?: string };

/** Pending and decided reassignment and end requests, newest first. */
export async function listAssignmentRequests(actorId: string) {
  await requireAdminRead(actorId);
  const rows = await prisma.adminApprovalRequest.findMany({
    where: { action: { in: [...ASSIGNMENT_ACTIONS] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, action: true, targetId: true, status: true, reason: true, payload: true, payloadSha256: true, createdAt: true, expiresAt: true, decidedAt: true, requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } } },
  });
  const ids = rows.flatMap((r) => {
    const p = r.payload as AssignmentPayload;
    return [p.studentUserId, p.fromPartnerId, p.toPartnerId].filter((x): x is string => Boolean(x));
  });
  const [students, partners] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    prisma.franchisePartner.findMany({ where: { id: { in: ids } }, select: { id: true, franchiseCode: true } }),
  ]);
  const studentBy = new Map(students.map((s) => [s.id, s]));
  const codeBy = new Map(partners.map((p) => [p.id, p.franchiseCode]));
  return rows.map((r) => {
    const p = r.payload as AssignmentPayload;
    return {
      id: r.id, kind: r.action === "STUDENT_REASSIGN" ? ("REASSIGN" as const) : ("END" as const), linkId: r.targetId, status: r.status, reason: r.reason, payloadSha256: r.payloadSha256,
      createdAt: r.createdAt, expiresAt: r.expiresAt, decidedAt: r.decidedAt, requestedBy: r.requestedBy, decidedBy: r.decidedBy,
      student: studentBy.get(p.studentUserId) ?? null,
      from: { partnerId: p.fromPartnerId, franchiseCode: codeBy.get(p.fromPartnerId) ?? null },
      to: p.toPartnerId ? { partnerId: p.toPartnerId, franchiseCode: codeBy.get(p.toPartnerId) ?? null } : null,
    };
  });
}

/** Locks the request row and returns it if it is a pending reassignment or end request. */
async function lockAssignmentRequest(tx: Prisma.TransactionClient, requestId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AdminApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const req = rows.length ? await tx.adminApprovalRequest.findUnique({ where: { id: requestId } }) : null;
  if (!req || !(ASSIGNMENT_ACTIONS as readonly string[]).includes(req.action)) throw new HttpError(404, "Not found");
  if (req.status !== "PENDING") throw new HttpError(409, `This request is ${req.status}.`, { code: "NOT_PENDING" });
  return req;
}

/**
 * Step 2: a different admin approves the exact request they reviewed. Everything is checked again under row
 * locks; then, in one transaction, the link is ENDED with the request id (the database refuses an end
 * without an approved two-admin request) and, for a reassignment, the new ACTIVE link is created with it.
 */
export async function approveAssignmentRequest(actorId: string, requestId: string, input: unknown) {
  const { expectedPayloadSha } = parse(z.object({ expectedPayloadSha: z.string().regex(/^[0-9a-f]{64}$/) }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const req = await lockAssignmentRequest(tx, requestId);
    if (req.requestedById === actorId) throw new HttpError(403, "A different admin must approve this request.", { code: "SAME_ADMIN" });
    if (req.payloadSha256 !== expectedPayloadSha) throw new HttpError(409, "The request isn't the one you reviewed.", { code: "PAYLOAD_MISMATCH" });
    if (req.expiresAt <= now) throw new HttpError(409, "This request has expired.", { code: "EXPIRED" });
    const p = req.payload as AssignmentPayload;
    const link = await lockActiveLink(tx, p.linkId, p.fromPartnerId);
    const decided = { requestId: req.id, requestedById: req.requestedById, approvedById: actorId, reason: req.reason };

    if (req.action === "STUDENT_ASSIGNMENT_END") {
      await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: now } });
      await tx.franchiseStudent.update({ where: { id: link.id }, data: { status: "ENDED", endsAt: now, endReason: `Ended by two admins (request ${req.id}): ${req.reason}`, endApprovalRequestId: req.id } });
      await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
      await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_STUDENT_ASSIGNMENT_ENDED", target: link.studentUserId, metadata: { ...decided, linkId: link.id, partnerId: link.partnerId, franchiseCode: link.partner.franchiseCode } } });
      return { requestId: req.id, kind: "END" as const, endedLinkId: link.id };
    }

    const target = await checkReassignment(tx, link.studentUserId, p.toPartnerId!, now);
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: now } });
    await tx.franchiseStudent.update({ where: { id: link.id }, data: { status: "ENDED", endsAt: now, endReason: `Reassigned to ${target.franchiseCode} (two-admin request ${req.id}): ${req.reason}`, endApprovalRequestId: req.id } });
    const created = await tx.franchiseStudent.create({ data: { partnerId: target.id, studentUserId: link.studentUserId, status: "ACTIVE", source: "ADMIN_REASSIGNMENT", approvalRequestId: req.id, createdById: actorId, startsAt: now } });
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "EXECUTED", executedAt: now, openKey: null } });
    await tx.auditLog.create({
      data: {
        actorId, action: "FRANCHISE_STUDENT_REASSIGNED", target: link.studentUserId,
        metadata: { ...decided, fromLinkId: link.id, toLinkId: created.id, fromPartnerId: link.partnerId, fromFranchiseCode: link.partner.franchiseCode, toPartnerId: target.id, toFranchiseCode: target.franchiseCode },
      },
    });
    return { requestId: req.id, kind: "REASSIGN" as const, endedLinkId: link.id, newLinkId: created.id, partnerId: target.id };
  });
}

/** The other admin rejects, or the requesting admin cancels; nothing changes either way. */
export async function closeAssignmentRequest(actorId: string, requestId: string, mode: "reject" | "cancel", input: unknown) {
  const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }).strict(), input);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const req = await lockAssignmentRequest(tx, requestId);
    if (mode === "cancel" && req.requestedById !== actorId) throw new HttpError(403, "Only the admin who asked can cancel this request.", { code: "NOT_REQUESTER" });
    if (mode === "reject" && req.requestedById === actorId) throw new HttpError(403, "Cancel your own request instead of rejecting it.", { code: "SAME_ADMIN" });
    await tx.adminApprovalRequest.update({ where: { id: req.id }, data: { status: mode === "reject" ? "REJECTED" : "CANCELLED", openKey: null, decidedAt: now, decisionNote: note ?? null, ...(mode === "reject" ? { decidedById: actorId } : {}) } });
    const p = req.payload as AssignmentPayload;
    const kind = req.action === "STUDENT_REASSIGN" ? "REASSIGN" : "END";
    await tx.auditLog.create({
      data: { actorId, action: `FRANCHISE_STUDENT_${kind}_${mode === "reject" ? "REJECTED" : "CANCELLED"}`, target: p.studentUserId, metadata: { requestId: req.id, requestedById: req.requestedById, note: note ?? null } },
    });
    return { id: req.id, status: mode === "reject" ? "REJECTED" : "CANCELLED" };
  });
}

// ---------- Audit history ----------

const auditSchema = z.object({
  action: z.string().trim().regex(/^[A-Z_]{3,80}$/, "Unknown action").optional(),
  target: z.string().trim().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const istDay = (d: string, end: boolean) => new Date(`${d}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);

/** Franchise and franchise-policy audit entries, newest first. Read-only; the log itself is never edited here. */
export async function franchiseAudit(actorId: string, query: unknown) {
  await requireAdminRead(actorId);
  const f = parse(auditSchema, query);
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      { OR: [{ action: { startsWith: "FRANCHISE_" } }, { action: { startsWith: "POLICY_" } }] },
      ...(f.action ? [{ action: f.action }] : []),
      ...(f.target ? [{ target: f.target }] : []),
      ...(f.from || f.to ? [{ createdAt: { ...(f.from ? { gte: istDay(f.from, false) } : {}), ...(f.to ? { lte: istDay(f.to, true) } : {}) } }] : []),
    ],
  };
  const [total, rows, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, action: true, target: true, metadata: true, createdAt: true, actor: { select: { name: true, role: true } } } }),
    prisma.auditLog.findMany({ where: { OR: [{ action: { startsWith: "FRANCHISE_" } }, { action: { startsWith: "POLICY_" } }] }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    total, page: f.page, pageSize: PAGE_SIZE,
    actions: actions.map((a) => a.action),
    entries: rows.map((r) => ({ id: r.id, action: r.action, target: r.target, metadata: r.metadata, createdAt: r.createdAt, actor: r.actor ? { name: r.actor.name, role: r.actor.role } : null })),
  };
}

// ---------- Partner support history ----------

export async function partnerSupportHistory(actorId: string, partnerId: string) {
  await requireAdminRead(actorId);
  if (!(await prisma.franchisePartner.findUnique({ where: { id: partnerId }, select: { id: true } }))) throw new HttpError(404, "Not found");
  const tickets = await prisma.supportTicket.findMany({
    where: { partnerId },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    select: { id: true, ticketNo: true, subject: true, category: true, status: true, awaiting: true, lastMessageAt: true, createdAt: true },
  });
  return { tickets };
}

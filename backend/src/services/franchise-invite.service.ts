import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import { sendEmail } from "./email.service.js";
import { courseProgress } from "./certificate.service.js";
import type { PartnerContext } from "./franchise-partner.service.js";
import { studentReference } from "./franchise-partner-dashboard.service.js";

/**
 * Franchise student invitations and links (Phase 5F-2). A partner invites by email; the student accepts
 * from their own, OTP-verified ETA account whose email matches the invitation. Partners never create
 * accounts, passwords or links on a student's behalf, and every partner query is scoped by the partner
 * id resolved on the server (PartnerContext) — never by an id from the request.
 */

type Tx = Prisma.TransactionClient;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SENDS = 5;
export const RESEND_MIN_GAP_MS = 15 * 60 * 1000;

const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};
const p2002 = (err: unknown) => typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";

/** Marks this partner's (or one email's) open invitations whose time has passed as EXPIRED. */
async function expireStale(db: Tx | typeof prisma, where: Prisma.FranchiseStudentInviteWhereInput) {
  await db.franchiseStudentInvite.updateMany({ where: { ...where, status: "OPEN", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
}

async function partnerForInvites(db: Tx | typeof prisma, ctx: PartnerContext) {
  const p = await db.franchisePartner.findUniqueOrThrow({
    where: { id: ctx.partnerId },
    select: { attributionAllowed: true, franchiseCode: true, user: { select: { name: true, email: true } }, district: { select: { name: true, state: { select: { name: true } } } } },
  });
  if (!p.attributionAllowed) throw new HttpError(409, "Student linking is paused for this franchise.", { code: "ATTRIBUTION_PAUSED" });
  return p;
}

/** Emails a fresh link; failures are logged (class only) and reported, never fatal. */
async function sendInviteEmail(to: string, inviteeName: string, token: string, partner: Awaited<ReturnType<typeof partnerForInvites>>, expiresAt: Date) {
  const link = `${env.siteUrl}/franchise/invite/${token}`;
  try {
    await sendEmail({
      to,
      subject: "You're invited to join an ETA franchise",
      html:
        `<p>Hello ${escapeHtml(inviteeName)},</p>` +
        `<p>${escapeHtml(partner.user.name)} (franchise ${escapeHtml(partner.franchiseCode)}, ${escapeHtml(partner.district.name)}, ${escapeHtml(partner.district.state.name)}) has invited you to join their franchise as a student of E-Commerce Training Academy.</p>` +
        `<p>Sign in to your own ETA account with this email address (or create one) and accept here: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` +
        `<p>The link expires on ${expiresAt.toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}. If you weren't expecting this, you can ignore it.</p>`,
    });
    return true;
  } catch (e) {
    console.error("[FRANCHISE] invitation email failed", { error: e instanceof Error ? e.name : "Error" });
    return false;
  }
}

// ---------- Partner: invitations ----------

const inviteSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the student's name").max(100),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
    mobile: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || /^[6-9]\d{9}$/.test(v), "Enter a 10-digit Indian mobile number"),
  })
  .strict();

const inviteView = (i: { id: string; inviteeName: string; email: string; mobile: string | null; status: string; expiresAt: Date; sendCount: number; lastSentAt: Date; createdAt: Date; acceptedAt: Date | null; revokedAt: Date | null }) => ({
  id: i.id,
  inviteeName: i.inviteeName,
  email: i.email,
  mobile: i.mobile,
  status: i.status,
  expiresAt: i.expiresAt,
  sendCount: i.sendCount,
  sendsLeft: Math.max(0, MAX_SENDS - i.sendCount),
  lastSentAt: i.lastSentAt,
  createdAt: i.createdAt,
  acceptedAt: i.acceptedAt,
  revokedAt: i.revokedAt,
});

export async function createInvite(ctx: PartnerContext, actorId: string, input: unknown) {
  const v = parse(inviteSchema, input);
  const now = new Date();
  const token = newToken();
  const { invite, partner } = await prisma.$transaction(async (tx) => {
    const partner = await partnerForInvites(tx, ctx);
    if (v.email === partner.user.email.toLowerCase()) throw new HttpError(400, "You can't invite yourself.", { code: "SELF_INVITE" });
    // Only this franchise's own links are checked here, so the answer reveals nothing about other franchises.
    const own = await tx.franchiseStudent.count({ where: { partnerId: ctx.partnerId, status: "ACTIVE", student: { email: { equals: v.email, mode: "insensitive" } } } });
    if (own) throw new HttpError(409, "This student is already linked to your franchise.", { code: "ALREADY_YOUR_STUDENT" });
    await expireStale(tx, { partnerId: ctx.partnerId, email: v.email });
    const invite = await tx.franchiseStudentInvite.create({
      // One clock for all three dates (the database's own default could land after lastSentAt).
      data: { partnerId: ctx.partnerId, inviteeName: v.name, email: v.email, mobile: v.mobile ?? null, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS), lastSentAt: now, createdAt: now, createdById: actorId },
    });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_INVITE_CREATED", target: invite.id, metadata: { partnerId: ctx.partnerId } } });
    return { invite, partner };
  }).catch((err) => {
    if (p2002(err)) throw new HttpError(409, "There's already an open invitation for this email. Resend it instead.", { code: "INVITE_EXISTS" });
    throw err;
  });
  const emailed = await sendInviteEmail(invite.email, invite.inviteeName, token, partner, invite.expiresAt);
  return { invite: inviteView(invite), emailed };
}

export async function listInvites(ctx: PartnerContext) {
  await expireStale(prisma, { partnerId: ctx.partnerId });
  const rows = await prisma.franchiseStudentInvite.findMany({ where: { partnerId: ctx.partnerId }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map(inviteView);
}

/** The invitation, but only if it belongs to the caller's franchise (anything else is a 404). */
async function ownInvite(tx: Tx, ctx: PartnerContext, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchiseStudentInvite" WHERE "id" = ${id} AND "partnerId" = ${ctx.partnerId} FOR UPDATE`;
  if (!rows.length) throw new HttpError(404, "Not found");
  return tx.franchiseStudentInvite.findUniqueOrThrow({ where: { id } });
}

/** A fresh link (the old one stops working), at most 5 sends, at least 15 minutes apart. Re-opens an expired one. */
export async function resendInvite(ctx: PartnerContext, actorId: string, id: string) {
  const now = new Date();
  const token = newToken();
  const { invite, partner } = await prisma.$transaction(async (tx) => {
    const partner = await partnerForInvites(tx, ctx);
    const inv = await ownInvite(tx, ctx, id);
    if (inv.status !== "OPEN" && inv.status !== "EXPIRED") throw new HttpError(409, `This invitation is ${inv.status.toLowerCase()}.`, { code: "NOT_RESENDABLE" });
    if (inv.sendCount >= MAX_SENDS) throw new HttpError(409, `An invitation can be sent at most ${MAX_SENDS} times.`, { code: "SEND_LIMIT" });
    const wait = inv.lastSentAt.getTime() + RESEND_MIN_GAP_MS - now.getTime();
    if (wait > 0) throw new HttpError(429, `Wait ${Math.ceil(wait / 60000)} more minute(s) before resending.`, { code: "TOO_SOON" });
    const invite = await tx.franchiseStudentInvite.update({
      where: { id },
      data: { status: "OPEN", tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS), sendCount: { increment: 1 }, lastSentAt: now },
    });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_INVITE_RESENT", target: id, metadata: { partnerId: ctx.partnerId, sendCount: invite.sendCount } } });
    return { invite, partner };
  }).catch((err) => {
    if (p2002(err)) throw new HttpError(409, "There's already an open invitation for this email.", { code: "INVITE_EXISTS" });
    throw err;
  });
  const emailed = await sendInviteEmail(invite.email, invite.inviteeName, token, partner, invite.expiresAt);
  return { invite: inviteView(invite), emailed };
}

export async function cancelInvite(ctx: PartnerContext, actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const inv = await ownInvite(tx, ctx, id);
    if (inv.status !== "OPEN" && inv.status !== "EXPIRED") throw new HttpError(409, `This invitation is ${inv.status.toLowerCase()}.`, { code: "NOT_CANCELLABLE" });
    const invite = await tx.franchiseStudentInvite.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: actorId } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_INVITE_CANCELLED", target: id, metadata: { partnerId: ctx.partnerId } } });
    return inviteView(invite);
  });
}

// ---------- Student: preview and accept (their own account) ----------

const tokenOrNotFound = (token: string) => {
  if (!TOKEN_SHAPE.test(token)) throw new HttpError(404, "This invitation link isn't valid.", { code: "INVITE_NOT_FOUND" });
  return hashToken(token);
};

export async function previewInvite(userId: string, token: string) {
  const hash = tokenOrNotFound(token);
  await expireStale(prisma, { tokenHash: hash });
  const inv = await prisma.franchiseStudentInvite.findUnique({
    where: { tokenHash: hash },
    include: { partner: { select: { franchiseCode: true, user: { select: { name: true } }, district: { select: { name: true, state: { select: { name: true } } } } } } },
  });
  if (!inv) throw new HttpError(404, "This invitation link isn't valid.", { code: "INVITE_NOT_FOUND" });
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return {
    status: inv.status,
    inviteeName: inv.inviteeName,
    expiresAt: inv.expiresAt,
    // Whether the signed-in account is the invited one — never the invited address itself.
    emailMatches: (me?.email ?? "").trim().toLowerCase() === inv.email,
    franchise: { code: inv.partner.franchiseCode, ownerName: inv.partner.user.name, district: inv.partner.district.name, state: inv.partner.district.state.name },
  };
}

export async function acceptInvite(userId: string, token: string) {
  const hash = tokenOrNotFound(token);
  const now = new Date();
  const refuse = (status: number, code: string, message: string) => new HttpError(status, message, { code });
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "FranchiseStudentInvite" WHERE "tokenHash" = ${hash} FOR UPDATE`;
    if (!rows.length) throw refuse(404, "INVITE_NOT_FOUND", "This invitation link isn't valid.");
    const inv = await tx.franchiseStudentInvite.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (inv.status === "OPEN" && inv.expiresAt <= now) return { expired: inv.id } as const; // recorded below, outside this refusal
    if (inv.status !== "OPEN") throw refuse(409, `INVITE_${inv.status}`, `This invitation is ${inv.status.toLowerCase()}.`);

    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, email: true, emailVerified: true, franchisePartner: { select: { id: true } } } });
    if (!user) throw refuse(401, "SIGN_IN_REQUIRED", "Sign in required");
    if (user.role !== "USER") throw refuse(403, "NOT_A_STUDENT_ACCOUNT", "Admin accounts can't join a franchise as students.");
    if (!user.emailVerified) throw refuse(403, "EMAIL_NOT_VERIFIED", "Verify your email address first.");
    if (user.email.trim().toLowerCase() !== inv.email) {
      await tx.auditLog.create({ data: { actorId: userId, action: "FRANCHISE_INVITE_EMAIL_MISMATCH", target: inv.id, metadata: { partnerId: inv.partnerId } } });
      return { mismatch: true } as const;
    }
    if (user.franchisePartner) throw refuse(409, "PARTNERS_CANNOT_JOIN", "Franchise partners can't join another franchise as students.");
    const linked = await tx.franchiseStudent.count({ where: { studentUserId: userId, status: "ACTIVE" } });
    if (linked) throw refuse(409, "ALREADY_LINKED", "Your account is already linked to a franchise.");

    // The inviting franchise must still be able to take students right now.
    const p = await tx.franchisePartner.findUniqueOrThrow({ where: { id: inv.partnerId }, select: { id: true, userId: true, status: true, attributionAllowed: true, districtId: true, agreementStartsAt: true, agreementEndsAt: true } });
    const allocated = await tx.stateAllocation.count({ where: { partnerId: p.id, role: "PRIMARY", status: "ALLOCATED" } });
    if (p.userId === userId || p.status !== "ACTIVE" || !p.attributionAllowed || now < p.agreementStartsAt || now >= p.agreementEndsAt || !allocated) {
      throw refuse(409, "FRANCHISE_UNAVAILABLE", "This franchise can't accept students right now.");
    }

    const link = await tx.franchiseStudent.create({ data: { partnerId: p.id, studentUserId: userId, status: "ACTIVE", source: "INVITE_ACCEPTED", startsAt: now, createdById: userId } });
    await tx.franchiseStudentInvite.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: now, acceptedUserId: userId, studentLinkId: link.id } });
    await tx.auditLog.create({ data: { actorId: userId, action: "FRANCHISE_INVITE_ACCEPTED", target: inv.id, metadata: { partnerId: p.id, studentLinkId: link.id } } });
    await tx.auditLog.create({ data: { actorId: userId, action: "FRANCHISE_STUDENT_LINKED", target: link.id, metadata: { partnerId: p.id, source: "INVITE_ACCEPTED", inviteId: inv.id } } });
    return { linked: link.id } as const;
  }).catch((err) => {
    if (p2002(err)) throw refuse(409, "ALREADY_LINKED", "Your account is already linked to a franchise.");
    throw err;
  });

  if ("expired" in result) {
    await prisma.franchiseStudentInvite.updateMany({ where: { id: result.expired, status: "OPEN", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
    throw refuse(410, "INVITE_EXPIRED", "This invitation has expired. Ask the franchise to send a new one.");
  }
  if ("mismatch" in result) {
    throw refuse(403, "EMAIL_MISMATCH", "This invitation was sent to a different email address. Sign in with the invited account.");
  }
  return { studentLinkId: result.linked };
}

// ---------- Partner: own students ----------

const studentListSchema = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) });

/**
 * The franchise's own ACTIVE students. Fields per decision D3 — name, linked date — plus a display
 * reference, the link status and how many courses the student currently has. No contact details.
 */
export async function listStudents(ctx: PartnerContext, query: unknown) {
  const f = parse(studentListSchema, query);
  const where: Prisma.FranchiseStudentWhereInput = { partnerId: ctx.partnerId, status: "ACTIVE", ...(f.q ? { student: { name: { contains: f.q, mode: "insensitive" } } } : {}) };
  const pageSize = 25;
  const [total, rows] = await Promise.all([
    prisma.franchiseStudent.count({ where }),
    prisma.franchiseStudent.findMany({ where, orderBy: [{ startsAt: "desc" }, { id: "asc" }], skip: (f.page - 1) * pageSize, take: pageSize, select: { id: true, startsAt: true, source: true, status: true, studentUserId: true, student: { select: { name: true } } } }),
  ]);
  const counts = new Map(
    (await prisma.courseAccess.groupBy({ by: ["userId"], where: { userId: { in: rows.map((r) => r.studentUserId) }, revokedAt: null }, _count: { _all: true } })).map((c) => [c.userId, c._count._all])
  );
  return {
    page: f.page,
    pageSize,
    total,
    students: rows.map((r) => ({ id: r.id, reference: studentReference(r.id), name: r.student.name, linkedAt: r.startsAt, source: r.source, status: r.status, enrolledCourses: counts.get(r.studentUserId) ?? 0 })),
  };
}

/**
 * One of the franchise's own students: name, linked date, and course progress (same rule as the
 * student sees). A link id from another franchise — or an ended link — is a plain 404. Audited.
 */
export async function studentDetail(ctx: PartnerContext, actorId: string, linkId: string) {
  const link = await prisma.franchiseStudent.findFirst({ where: { id: linkId, partnerId: ctx.partnerId, status: "ACTIVE" }, select: { id: true, startsAt: true, studentUserId: true, student: { select: { name: true } } } });
  if (!link) throw new HttpError(404, "Not found");
  const access = await prisma.courseAccess.findMany({ where: { userId: link.studentUserId, revokedAt: null }, orderBy: { unlockedAt: "asc" }, select: { courseId: true, unlockedAt: true, course: { select: { title: true } } } });
  const courses = [];
  for (const a of access) {
    const p = await courseProgress(link.studentUserId, a.courseId);
    courses.push({ title: a.course.title, enrolledAt: a.unlockedAt, percent: p.percent, completedLessons: p.completedLessons, totalLessons: p.totalLessons, isComplete: p.isComplete, language: p.language?.name ?? null });
  }
  await prisma.auditLog.create({ data: { actorId, action: "FRANCHISE_STUDENT_VIEWED", target: link.id, metadata: { partnerId: ctx.partnerId } } });
  return { id: link.id, name: link.student.name, linkedAt: link.startsAt, courses };
}

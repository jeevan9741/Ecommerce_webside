import { z } from "zod";
import type { FranchiseApplicationStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import { sendEmail } from "./email.service.js";
import { STATUS_LABEL } from "./franchise-application.service.js";
import { HOLDING_STATUSES } from "./franchise-location.service.js";

/**
 * Admin review of franchise applications (Phase 5A): list and search, an audited detail view,
 * create-only internal notes and the review status transitions. Approval does NOT reserve or
 * allocate a district (that is a later phase); it only refuses when the district is held, disabled
 * or already has an approved application, checked under a per-district lock.
 */

type Tx = Prisma.TransactionClient;
type Status = FranchiseApplicationStatus;

/** The only moves an admin can make in this phase. Nothing leaves REJECTED or APPROVED here. */
export const REVIEW_TRANSITIONS: Partial<Record<Status, Status[]>> = {
  APPLICATION_SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["INTERVIEW_DISCUSSION", "APPROVED", "REJECTED"],
  INTERVIEW_DISCUSSION: ["APPROVED", "REJECTED"],
};
/** An application in any of these holds its district against other approvals. */
const APPROVED_OR_LATER: Status[] = ["APPROVED", "PAYMENT_PENDING", "AGREEMENT_PENDING", "ACTIVE_FRANCHISE"];
const NOTIFIED: Status[] = ["UNDER_REVIEW", "INTERVIEW_DISCUSSION", "APPROVED", "REJECTED"];

export const allowedTransitions = (status: Status): Status[] => REVIEW_TRANSITIONS[status] ?? [];

const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
};

/** The acting admin, re-read and locked inside the transaction (a demoted admin can't finish an action). */
async function requireAdminInTx(tx: Tx, actorId: string) {
  const rows = await tx.$queryRaw<{ role: string }[]>`SELECT "role"::text AS "role" FROM "User" WHERE "id" = ${actorId} FOR SHARE`;
  if (rows[0]?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

/**
 * Reads re-check the role too: the session token carries the role it was issued with, so a demoted
 * admin's old token must not keep reading applicants' personal data.
 */
async function requireAdmin(actorId: string) {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (u?.role !== "ADMIN") throw new HttpError(403, "Admin access required");
}

// ---------- List ----------

const STATUSES = Object.keys(STATUS_LABEL) as [Status, ...Status[]];
const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  stateId: z.string().min(1).max(40).optional(),
  districtId: z.string().min(1).max(40).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD").optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Filter dates are whole days in IST (the business's day). */
const istDay = (d: string, endOfDay: boolean) => new Date(`${d}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`);

export async function listApplications(actorId: string, query: unknown) {
  await requireAdmin(actorId);
  const f = parse(listSchema, query);
  const where: Prisma.FranchiseApplicationWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.stateId ? { stateId: f.stateId } : {}),
    ...(f.districtId ? { districtId: f.districtId } : {}),
    ...(f.from || f.to ? { submittedAt: { ...(f.from ? { gte: istDay(f.from, false) } : {}), ...(f.to ? { lte: istDay(f.to, true) } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { applicationNo: { contains: f.q, mode: "insensitive" } },
            { applicantName: { contains: f.q, mode: "insensitive" } },
            { email: { contains: f.q, mode: "insensitive" } },
            { mobile: { contains: f.q.replace(/\D/g, "") || f.q } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.franchiseApplication.count({ where }),
    prisma.franchiseApplication.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      // Minimal fields only: contact details, answers and documents are in the audited detail view.
      select: { id: true, applicationNo: true, applicantName: true, status: true, submittedAt: true, version: true, state: { select: { name: true } }, district: { select: { name: true } } },
    }),
  ]);
  return {
    page: f.page,
    pageSize: f.pageSize,
    total,
    applications: rows.map((r) => ({ id: r.id, applicationNo: r.applicationNo, applicantName: r.applicantName, state: r.state.name, district: r.district.name, status: r.status, statusLabel: STATUS_LABEL[r.status], submittedAt: r.submittedAt, version: r.version })),
  };
}

export async function applicationSummary(actorId: string) {
  await requireAdmin(actorId);
  const rows = await prisma.franchiseApplication.groupBy({ by: ["status"], _count: true });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const r of rows) counts[r.status] = r._count;
  return { counts, total: rows.reduce((n, r) => n + r._count, 0) };
}

// ---------- Detail ----------

/** Why the district couldn't be approved right now (shown before an admin tries). */
async function districtConflict(db: Tx | typeof prisma, app: { id: string; districtId: string }) {
  const [district, held, approved] = await Promise.all([
    db.district.findUnique({ where: { id: app.districtId }, select: { isActive: true, state: { select: { isActive: true } } } }),
    db.districtAllocation.count({ where: { districtId: app.districtId, role: "PRIMARY", status: { in: [...HOLDING_STATUSES] } } }),
    db.franchiseApplication.findFirst({ where: { districtId: app.districtId, status: { in: APPROVED_OR_LATER }, id: { not: app.id } }, select: { applicationNo: true } }),
  ]);
  return {
    districtActive: Boolean(district?.isActive && district.state.isActive),
    held: held > 0,
    approvedApplicationNo: approved?.applicationNo ?? null,
  };
}

export async function applicationDetail(actorId: string, id: string) {
  await requireAdmin(actorId);
  const app = await prisma.franchiseApplication.findUnique({
    where: { id },
    include: {
      state: { select: { name: true } },
      district: { select: { name: true, code: true } },
      user: { select: { id: true, emailVerified: true, createdAt: true } },
      documents: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true } },
      history: { orderBy: { createdAt: "asc" }, select: { id: true, fromStatus: true, toStatus: true, actorType: true, actorId: true, applicantNote: true, internalNote: true, createdAt: true } },
      notes: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, authorId: true, createdAt: true } },
    },
  });
  if (!app) throw new HttpError(404, "Not found");
  const people = await prisma.user.findMany({
    where: { id: { in: [...new Set([...app.history.map((h) => h.actorId), ...app.notes.map((n) => n.authorId), app.approvedById].filter((x): x is string => Boolean(x)))] } },
    select: { id: true, name: true },
  });
  const nameOf = (uid: string | null) => (uid ? (people.find((p) => p.id === uid)?.name ?? "Unknown") : null);
  // Every look at an applicant's personal details is recorded (ids only).
  await prisma.auditLog.create({ data: { actorId, action: "FRANCHISE_APPLICATION_VIEWED", target: app.id, metadata: { applicationNo: app.applicationNo } } });
  return {
    id: app.id,
    applicationNo: app.applicationNo,
    status: app.status,
    statusLabel: STATUS_LABEL[app.status],
    version: app.version,
    submittedAt: app.submittedAt,
    updatedAt: app.updatedAt,
    applicant: {
      userId: app.user.id,
      name: app.applicantName,
      email: app.email,
      mobile: app.mobile,
      address: app.address,
      emailVerified: Boolean(app.user.emailVerified),
      accountCreatedAt: app.user.createdAt,
    },
    location: { stateId: app.stateId, state: app.state.name, districtId: app.districtId, district: app.district.name, districtCode: app.district.code },
    answers: {
      education: app.education,
      businessExperience: app.businessExperience,
      officeAvailable: app.officeAvailable,
      investmentCapacityInr: app.investmentCapacityInr,
      businessPlanText: app.businessPlanText,
    },
    refundPolicy: { version: app.refundPolicyVersion, sha256: app.refundPolicySha256 },
    requiredDocumentKinds: app.requiredDocumentKinds,
    // Metadata only: document access arrives with the document-review phase.
    documents: app.documents,
    decision: { approvedAt: app.approvedAt, approvedBy: nameOf(app.approvedById), rejectedAt: app.rejectedAt, rejectionReason: app.rejectionReason },
    history: app.history.map((h) => ({ ...h, fromLabel: h.fromStatus ? STATUS_LABEL[h.fromStatus] : null, toLabel: STATUS_LABEL[h.toStatus], actorName: h.actorType === "ADMIN" ? nameOf(h.actorId) : h.actorType === "APPLICANT" ? "Applicant" : "System" })),
    notes: app.notes.map((n) => ({ id: n.id, body: n.body, author: nameOf(n.authorId), createdAt: n.createdAt })),
    allowedTransitions: allowedTransitions(app.status),
    district: await districtConflict(prisma, app),
  };
}

// ---------- Notes (create-only) ----------

const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(2000, "Notes are at most 2000 characters") });

export async function addNote(actorId: string, id: string, input: unknown) {
  const { body } = parse(noteSchema, input);
  return prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const app = await tx.franchiseApplication.findUnique({ where: { id }, select: { id: true } });
    if (!app) throw new HttpError(404, "Not found");
    // Internal only: notes are never shown to the applicant (applicant-facing text goes with a status change).
    const note = await tx.franchiseApplicationNote.create({ data: { applicationId: id, authorId: actorId, body, visibleToApplicant: false } });
    await tx.auditLog.create({ data: { actorId, action: "FRANCHISE_APPLICATION_NOTE_ADDED", target: id, metadata: { noteId: note.id, length: body.length } } });
    return { id: note.id, createdAt: note.createdAt };
  });
}

// ---------- Status transitions ----------

const transitionSchema = z
  .object({
    to: z.enum(["UNDER_REVIEW", "INTERVIEW_DISCUSSION", "APPROVED", "REJECTED"]),
    expectedVersion: z.number().int().min(0),
    applicantNote: z.string().trim().max(500, "The note to the applicant is at most 500 characters").optional(),
    internalNote: z.string().trim().max(2000, "The internal note is at most 2000 characters").optional(),
    rejectionReason: z.string().trim().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to === "REJECTED") {
      const n = v.rejectionReason?.length ?? 0;
      if (n < 10 || n > 1000) ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "Give the applicant a reason of 10–1000 characters" });
    } else if (v.rejectionReason) {
      ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "A rejection reason is only for rejections" });
    }
  });

export async function transitionApplication(actorId: string, id: string, input: unknown) {
  const t = parse(transitionSchema, input);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await requireAdminInTx(tx, actorId);
    const app = await tx.franchiseApplication.findUnique({ where: { id }, select: { id: true, status: true, version: true, districtId: true, userId: true, email: true, applicationNo: true } });
    if (!app) throw new HttpError(404, "Not found");
    if (!allowedTransitions(app.status).includes(t.to)) {
      throw new HttpError(409, `An application that is "${STATUS_LABEL[app.status]}" can't move to "${STATUS_LABEL[t.to]}".`, { code: "INVALID_TRANSITION", status: app.status });
    }
    if (app.version !== t.expectedVersion) throw new HttpError(409, "This application changed since you opened it — reload and try again.", { code: "STALE", version: app.version });

    if (t.to === "APPROVED") {
      // One decision per district at a time; no allocation or reservation is created in this phase.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eta-district:${app.districtId}`}))`;
      const c = await districtConflict(tx, app);
      if (!c.districtActive) throw new HttpError(409, "This district is disabled, so it can't be approved.", { code: "DISTRICT_DISABLED" });
      if (c.held) throw new HttpError(409, "This district is already held by a franchise.", { code: "DISTRICT_UNAVAILABLE" });
      if (c.approvedApplicationNo) throw new HttpError(409, `Another application for this district (${c.approvedApplicationNo}) is already approved.`, { code: "DISTRICT_ALREADY_APPROVED" });
    }

    // Version-guarded write: a concurrent decision (or a stale form) changes nothing.
    const { count } = await tx.franchiseApplication.updateMany({
      where: { id, status: app.status, version: t.expectedVersion },
      data: {
        status: t.to,
        version: { increment: 1 },
        ...(t.to === "APPROVED" ? { approvedAt: now, approvedById: actorId } : {}),
        ...(t.to === "REJECTED" ? { rejectionReason: t.rejectionReason, rejectedAt: now } : {}),
      },
    });
    if (count !== 1) throw new HttpError(409, "This application changed since you opened it — reload and try again.", { code: "STALE" });
    await tx.franchiseApplicationStatusHistory.create({
      data: { applicationId: id, fromStatus: app.status, toStatus: t.to, actorId, actorType: "ADMIN", applicantNote: t.applicantNote || null, internalNote: t.internalNote || null },
    });
    await tx.auditLog.create({
      data: { actorId, action: "FRANCHISE_APPLICATION_STATUS_CHANGED", target: id, metadata: { applicationNo: app.applicationNo, from: app.status, to: t.to, version: t.expectedVersion + 1 } },
    });
    return { app, version: t.expectedVersion + 1 };
  });
  if (NOTIFIED.includes(t.to)) {
    await notifyStatus(result.app.id, result.app.userId, result.app.email, result.app.applicationNo, t.to).catch((e) =>
      console.error("[FRANCHISE] status notification record failed", { applicationId: result.app.id, error: e instanceof Error ? e.name : "Error" })
    );
  }
  return { id, status: t.to, statusLabel: STATUS_LABEL[t.to], version: result.version };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** After the commit: the new status and a portal link only — reasons and notes stay behind sign-in. */
async function notifyStatus(applicationId: string, userId: string, to: string, applicationNo: string, status: Status) {
  const link = `${env.siteUrl}/franchise/application`;
  let result = "SENT";
  let error: string | null = null;
  try {
    await sendEmail({
      to,
      subject: `Update on your franchise application ${applicationNo}`,
      html:
        `<p>The status of your franchise application <strong>${escapeHtml(applicationNo)}</strong> is now: <strong>${escapeHtml(STATUS_LABEL[status])}</strong>.</p>` +
        `<p>Sign in to see the details: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    });
  } catch (e) {
    result = "FAILED";
    error = e instanceof Error ? e.name : "Error"; // class only: provider messages can echo the address
  }
  await prisma.franchiseNotification.create({ data: { applicationId, recipientUserId: userId, kind: `STATUS_${status}`, status: result, error } });
}

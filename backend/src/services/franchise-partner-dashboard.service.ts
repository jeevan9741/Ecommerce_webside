import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { courseLessons, courseProgress } from "./certificate.service.js";
import type { PartnerContext } from "./franchise-partner.service.js";

/**
 * The Franchise Partner dashboard's read-only views: overview, course enrolments, learning progress and
 * earnings status. Every query starts from the database-verified PartnerContext (set by
 * requireFranchisePartner) and reaches students ONLY through this partner's ACTIVE FranchiseStudent links.
 * Nothing is ever taken from the request except a search text and a page number — a partnerId,
 * franchiseId or studentId in the query is simply never read. No contact details, documents, payment or
 * order data are returned.
 */

export const PAGE_SIZE = 25;
/** Progress summary is computed over at most this many enrolments; beyond it the summary says it's partial. */
const SUMMARY_LIMIT = 500;

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
function parseList(query: unknown) {
  // Only `q` and `page` are read; every other key (partnerId, studentId, …) is ignored by construction.
  const raw = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const r = listSchema.safeParse({ q: raw.q, page: raw.page });
  if (!r.success) throw new HttpError(400, "Invalid search or page.", { code: "INVALID_REQUEST" });
  return r.data;
}

/** Students of this partner, through an ACTIVE link only. */
const ownStudent = (ctx: PartnerContext): Prisma.UserWhereInput => ({ franchiseStudentLinks: { some: { partnerId: ctx.partnerId, status: "ACTIVE" } } });

/** Short, display-only student reference derived from the franchise link (never a user id). */
export const studentReference = (linkId: string) => `FS-${linkId.slice(-8).toUpperCase()}`;

/** Map userId → this partner's ACTIVE link id, for the users on one page. */
async function linksFor(ctx: PartnerContext, userIds: string[]) {
  const links = await prisma.franchiseStudent.findMany({ where: { partnerId: ctx.partnerId, status: "ACTIVE", studentUserId: { in: userIds } }, select: { id: true, studentUserId: true } });
  return new Map(links.map((l) => [l.studentUserId, l.id]));
}

/** The most recent player report for this student on this course's lessons, or null if none was ever recorded. */
async function lastActivity(userId: string, courseId: string) {
  const lessons = await courseLessons(courseId);
  if (lessons.length === 0) return null;
  const row = await prisma.videoProgress.findFirst({ where: { userId, videoId: { in: lessons.map((l) => l.id) } }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } });
  return row?.updatedAt ?? null;
}

// ---------- Overview ----------

export async function partnerOverview(ctx: PartnerContext) {
  const [students, activeEnrolments, endedEnrolments] = await Promise.all([
    prisma.franchiseStudent.count({ where: { partnerId: ctx.partnerId, status: "ACTIVE" } }),
    prisma.courseAccess.count({ where: { revokedAt: null, user: ownStudent(ctx) } }),
    prisma.courseAccess.count({ where: { revokedAt: { not: null }, user: ownStudent(ctx) } }),
  ]);

  // Progress summary from the same rule the student sees; courses without lessons are "unavailable".
  const sample = await prisma.courseAccess.findMany({ where: { revokedAt: null, user: ownStudent(ctx) }, orderBy: { unlockedAt: "desc" }, take: SUMMARY_LIMIT, select: { userId: true, courseId: true } });
  const progress = { completed: 0, inProgress: 0, notStarted: 0, unavailable: 0, counted: sample.length, partial: activeEnrolments > sample.length };
  for (const a of sample) {
    const p = await courseProgress(a.userId, a.courseId);
    if (p.totalLessons === 0) progress.unavailable += 1;
    else if (p.isComplete) progress.completed += 1;
    else if (p.completedLessons > 0) progress.inProgress += 1;
    else progress.notStarted += 1;
  }

  return { students, enrolments: { active: activeEnrolments, ended: endedEnrolments }, progress, earnings: earningsStatus() };
}

// ---------- Course enrolments ----------

export async function listEnrolments(ctx: PartnerContext, query: unknown) {
  const f = parseList(query);
  const where: Prisma.CourseAccessWhereInput = {
    user: ownStudent(ctx),
    ...(f.q ? { OR: [{ user: { name: { contains: f.q, mode: "insensitive" } } }, { course: { title: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.courseAccess.count({ where }),
    prisma.courseAccess.findMany({
      where,
      orderBy: [{ unlockedAt: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, userId: true, unlockedAt: true, revokedAt: true, user: { select: { name: true } }, course: { select: { title: true } } },
    }),
  ]);
  const links = await linksFor(ctx, [...new Set(rows.map((r) => r.userId))]);
  return {
    page: f.page,
    pageSize: PAGE_SIZE,
    total,
    enrolments: rows.map((r) => ({
      id: r.id,
      studentReference: studentReference(links.get(r.userId)!),
      studentLinkId: links.get(r.userId)!,
      studentName: r.user.name,
      courseTitle: r.course.title,
      enrolledAt: r.unlockedAt,
      status: r.revokedAt ? ("ENDED" as const) : ("ACTIVE" as const),
      accessStatus: r.revokedAt ? ("REVOKED" as const) : ("ACTIVE" as const),
    })),
  };
}

// ---------- Learning progress ----------

export async function listProgress(ctx: PartnerContext, query: unknown) {
  const f = parseList(query);
  const where: Prisma.CourseAccessWhereInput = {
    revokedAt: null,
    user: ownStudent(ctx),
    ...(f.q ? { OR: [{ user: { name: { contains: f.q, mode: "insensitive" } } }, { course: { title: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.courseAccess.count({ where }),
    prisma.courseAccess.findMany({
      where,
      orderBy: [{ unlockedAt: "desc" }, { id: "asc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, userId: true, courseId: true, user: { select: { name: true } }, course: { select: { title: true } } },
    }),
  ]);
  const links = await linksFor(ctx, [...new Set(rows.map((r) => r.userId))]);
  const progress = [];
  for (const r of rows) {
    const [p, last] = await Promise.all([courseProgress(r.userId, r.courseId), lastActivity(r.userId, r.courseId)]);
    const available = p.totalLessons > 0;
    progress.push({
      id: r.id,
      studentReference: studentReference(links.get(r.userId)!),
      studentLinkId: links.get(r.userId)!,
      studentName: r.user.name,
      courseTitle: r.course.title,
      available,
      completedLessons: available ? p.completedLessons : null,
      totalLessons: available ? p.totalLessons : null,
      percent: available ? p.percent : null,
      isComplete: available ? p.isComplete : null,
      lastActivityAt: last,
    });
  }
  return { page: f.page, pageSize: PAGE_SIZE, total, progress };
}

// ---------- Earnings ----------

/**
 * No franchise earnings, revenue-share, settlement or payout records are written anywhere yet (the
 * ledger tables exist but nothing posts to them), so there is nothing authoritative to show. This never
 * derives figures from prices or enrolment counts.
 */
export const EARNINGS_UNAVAILABLE_MESSAGE = "Earnings information will be available after the franchise financial system is activated.";

export function earningsStatus() {
  return {
    available: false as const,
    message: EARNINGS_UNAVAILABLE_MESSAGE,
    missing: [
      "Attribution of course orders to a franchise (FranchiseOrderAttribution is never written)",
      "Revenue-share posting into the ledger (LedgerJournal / LedgerEntry / EarningsLot are never written)",
      "Approved revenue-share formula, GST treatment and refund / chargeback recovery rules (policy items still PENDING)",
      "Settlement batches and the weekly settlement schedule",
      "Payout records and a verified payout provider (FranchisePayout is never written)",
      "TDS deduction and partner statements",
    ],
    // A franchise referral commission isn't defined anywhere (no policy, no attribution, no ledger
    // posting). The owner's personal student-referral commissions (CommissionLedger) belong to their
    // own account, not to the franchise, and are deliberately not mixed in here.
    referral: {
      available: false as const,
      message: "Franchise referral commission isn't set up yet. No referral figures are shown until it is defined and recorded.",
    },
  };
}

export async function partnerEarnings(_ctx: PartnerContext) {
  // Scoped like every partner route (the caller is a verified active partner); returns status only.
  return earningsStatus();
}

import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import type { SessionPayload } from "../utils/tokens.js";

/**
 * Paid-package rule for protected downloads and live classes: the student holds live (not revoked)
 * CourseAccess to the package AND the order behind it is PAID. CourseAccess is only ever created by
 * markOrderPaid after Razorpay confirms a captured payment for the exact amount, and reverseOrder
 * revokes it on refund — the order check is a second guard so a REFUNDED/CANCELLED order can never
 * unlock anything even if a revocation were missed. Nothing the browser sends (price, package, status)
 * is trusted. Admins can open everything.
 *
 * Every paid-content check in the app (dashboard gate, course content, video library, e-books, live
 * classes, certificates) filters CourseAccess with PAID_ACCESS — use it rather than `revokedAt: null`.
 */
export const PAID_ACCESS = { revokedAt: null, order: { status: "PAID" } } satisfies Prisma.CourseAccessWhereInput;

/** IDs of packages the user has paid for and still holds. */
export async function paidPackageIds(userId: string) {
  const rows = await prisma.courseAccess.findMany({ where: { userId, ...PAID_ACCESS }, select: { courseId: true } });
  return new Set(rows.map((r) => r.courseId));
}

/** Whether the user holds paid, live access to the package (no admin bypass). */
export async function ownsPaidPackage(userId: string, courseId: string) {
  return (await prisma.courseAccess.count({ where: { userId, courseId, ...PAID_ACCESS } })) > 0;
}

export async function hasPaidPackage(user: SessionPayload, courseId: string) {
  return user.role === "ADMIN" || ownsPaidPackage(user.id, courseId);
}

/** Active packages, cheapest first — what a "locked" screen offers. */
export async function packagesById(ids: Iterable<string>) {
  return prisma.course.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: { id: true, title: true, type: true, priceInPaise: true },
    orderBy: { priceInPaise: "asc" },
  });
}

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

// ---------- E-book languages ----------

/**
 * Which e-book languages of one package a student may open: exactly the languages of their PAID
 * orders. There is no "every language" case for students (the pre-release all-language exception was
 * retired once its one buyer's purchased language was recorded on the order); admins bypass this check.
 */
export interface EBookLanguageAccess {
  codes: Set<string>;
}

/**
 * E-book language access per package, for packages the user holds paid, live access to. Languages
 * come only from the user's own PAID orders (`selectedLanguage`, validated at checkout) — never from
 * the browser, the profile language or CourseAccess.languageGranted. Each PAID order adds its
 * language, so a refund removes only its own. Packages without paid access are absent.
 */
export async function ebookLanguageAccess(userId: string, courseIds?: Iterable<string>) {
  const owned = await prisma.courseAccess.findMany({
    where: { userId, ...PAID_ACCESS, ...(courseIds ? { courseId: { in: [...courseIds] } } : {}) },
    select: { courseId: true },
  });
  const access = new Map<string, EBookLanguageAccess>(owned.map((r) => [r.courseId, { codes: new Set<string>() }]));
  if (access.size === 0) return access;

  const orders = await prisma.order.findMany({
    where: { userId, courseId: { in: [...access.keys()] }, status: "PAID" },
    select: { courseId: true, selectedLanguage: true },
  });
  // An order without a language opens no e-book language.
  for (const order of orders) if (order.selectedLanguage) access.get(order.courseId)!.codes.add(order.selectedLanguage);
  return access;
}

/** Whether that access opens an e-book in `languageCode`. E-books without a language never open. */
export function opensLanguage(access: EBookLanguageAccess | undefined, languageCode: string | null | undefined) {
  return Boolean(access && languageCode && access.codes.has(languageCode));
}

/** Active languages of a package's published e-books — what its checkout must choose from. */
export async function ebookLanguagesOf(courseId: string) {
  return prisma.language.findMany({
    where: { isActive: true, ebooks: { some: { courseId, isPublished: true } } },
    select: { code: true, name: true, nativeName: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

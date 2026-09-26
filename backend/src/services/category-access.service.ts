import { prisma } from "../config/prisma.js";
import type { SessionPayload } from "../utils/tokens.js";

/**
 * Category access rules (see CourseCategory / CategoryPackage in the schema):
 * - Access is granted per TOP-LEVEL category and covers all of its subcategories.
 * - A student has it while they hold live (not revoked) CourseAccess to any package linked to it.
 * - Inactive categories — or subcategories of an inactive category — are hidden from students.
 * - Admins can open everything.
 */

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  parent: { id: string; name: string; slug: string; isActive: boolean } | null;
}

export const categoryRefSelect = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  parent: { select: { id: true, name: true, slug: true, isActive: true } },
} as const;

/** The top-level category that controls access for `category`. */
export function topOf(category: CategoryRef) {
  return category.parent ?? category;
}

/** Visible to students: itself and (for a subcategory) its parent are active. */
export function isLive(category: CategoryRef) {
  return category.isActive && (category.parent?.isActive ?? true);
}

/** Package IDs the user currently owns (live access only). */
export async function ownedPackageIds(userId: string) {
  const rows = await prisma.courseAccess.findMany({ where: { userId, revokedAt: null }, select: { courseId: true } });
  return new Set(rows.map((r) => r.courseId));
}

/** Whether the user may watch videos in top-level category `topCategoryId`. */
export async function hasCategoryAccess(user: SessionPayload, topCategoryId: string) {
  if (user.role === "ADMIN") return true;
  const linked = await prisma.categoryPackage.count({
    where: { categoryId: topCategoryId, course: { access: { some: { userId: user.id, revokedAt: null } } } },
  });
  return linked > 0;
}

/** Active packages that unlock a top-level category — what the "locked" screen offers. */
export async function unlockingPackages(topCategoryId: string) {
  const rows = await prisma.categoryPackage.findMany({
    where: { categoryId: topCategoryId, course: { isActive: true } },
    select: { course: { select: { id: true, title: true, priceInPaise: true } } },
    orderBy: { course: { priceInPaise: "asc" } },
  });
  return rows.map((r) => r.course);
}

/**
 * The Franchise Management section of the admin dashboard. Import-free so the Node test runner can load it.
 * The pages keep their existing URLs; this only groups them under one menu.
 */

export const FRANCHISE_ADMIN_SECTIONS = [
  { href: "/admin/franchise", label: "Overview" },
  { href: "/admin/franchise-states", label: "State Management", also: ["/admin/franchise-locations"] },
  { href: "/admin/franchise-applications", label: "Applications" },
  { href: "/admin/franchise-partners", label: "Franchise Partners" },
  { href: "/admin/franchise-assignments", label: "Student Assignments" },
  { href: "/admin/franchise-tickets", label: "Support Tickets" },
  { href: "/admin/franchise-policies", label: "Policies & Privacy Notice" },
  { href: "/admin/franchise-audit", label: "Audit History" },
] as const satisfies readonly { href: string; label: string; also?: readonly string[] }[];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Every franchise admin page: /admin/franchise and /admin/franchise-…, nothing else. */
export function isFranchiseAdminPath(pathname: string) {
  return pathname === "/admin/franchise" || pathname.startsWith("/admin/franchise/") || pathname.startsWith("/admin/franchise-");
}

/** The section a page belongs to (its own href, or a related page listed in `also`), or null. */
export function activeFranchiseSection(pathname: string): string | null {
  for (const s of FRANCHISE_ADMIN_SECTIONS) {
    const related = "also" in s ? s.also : [];
    if (under(pathname, s.href) || related.some((h) => under(pathname, h))) return s.href;
  }
  return null;
}

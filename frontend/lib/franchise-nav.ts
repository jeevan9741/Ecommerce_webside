/**
 * Which franchise entry points the navbar shows. Import-free so the Node test runner can load it.
 * Showing a link never grants anything: every page and API behind it checks access on the server.
 */

export interface NavLink {
  href: string;
  label: string;
}

export const BECOME_PARTNER_LINK: NavLink = { href: "/franchise", label: "Become a Franchise Partner" };
export const FRANCHISE_LINK: NavLink = { href: "/franchise", label: "Franchise" };
export const FRANCHISE_DASHBOARD_LINK: NavLink = { href: "/franchise-partner", label: "Franchise Dashboard" };

/** Visitors: the call-to-action beside Login, only while the public franchise pages are switched on. */
export const visitorFranchiseCta = (publicOn: boolean): NavLink | null => (publicOn ? BECOME_PARTNER_LINK : null);

/**
 * Signed-in customers: an active partner (per the server, with the partner switch on) gets the dashboard;
 * anyone else gets the public franchise page while that is switched on. Admins never get either.
 */
export function signedInFranchiseLink(opts: { role: string | undefined; publicOn: boolean; partnerOn: boolean; partnerActive: boolean }): NavLink | null {
  if (opts.role === "ADMIN") return null;
  if (opts.partnerOn && opts.partnerActive) return FRANCHISE_DASHBOARD_LINK;
  return opts.publicOn ? FRANCHISE_LINK : null;
}

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

/**
 * Always shown to visitors (navbar and homepage). While a feature is switched off its page explains that it
 * is coming soon; nothing behind these links opens applications or partner access.
 */
export const PARTNER_LOGIN_LINK: NavLink = { href: "/franchise-partner", label: "Franchise Partner Login" };
export const APPLY_LINK: NavLink = { href: "/franchise/apply", label: "Become a Franchise Partner" };

/**
 * The partner area asks visitors to sign in only while the partner dashboard is switched on; otherwise it
 * shows its "coming soon" page to everyone instead of a login form for a feature that doesn't exist yet.
 */
export const partnerAreaNeedsSignIn = (partnerOn: boolean) => partnerOn;

/**
 * Browser title for /franchise-partner and every route under it. While switched off it is exactly
 * "Franchise Partner Login | Coming Soon" (absolute: no site-name suffix); while on, the dashboard title.
 */
export const partnerAreaTitle = (partnerOn: boolean): string | { absolute: string } =>
  partnerOn ? "Franchise Dashboard" : { absolute: "Franchise Partner Login | Coming Soon" };

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

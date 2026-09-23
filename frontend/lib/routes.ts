export type Role = "USER" | "ADMIN";

/** Where a signed-in user belongs by default: admins to the admin panel, everyone else to their portal. */
export function homeFor(role: Role | undefined | null): string {
  return role === "ADMIN" ? "/admin" : "/dashboard";
}

/**
 * Picks the post-login destination. A `callbackUrl` is only honoured when it is a same-site path
 * (so a crafted link can't bounce users to another site), and admins headed for the customer
 * portal by default are sent to the admin panel instead.
 */
export function postLoginPath(role: Role, callbackUrl: string | null): string {
  const safe = sameSitePath(callbackUrl);
  if (!safe) return homeFor(role);
  if (role === "ADMIN" && (safe === "/dashboard" || safe.startsWith("/dashboard/"))) return homeFor(role);
  return safe;
}

/** Resolves the value the way a browser would and keeps it only if it stays on this site. */
function sameSitePath(value: string | null): string | null {
  if (!value || !value.startsWith("/")) return null;
  const base = "http://same-site.invalid";
  try {
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** Marks a Courses visit as arriving straight from signup, so the page scrolls to the packages. */
export const WELCOME_PARAM = "welcome";

/**
 * Where a finished signup lands. A new account has nothing to study yet, so it goes to the
 * packages; an account that already owns one has nothing to buy and starts in its portal.
 */
export function postSignupPath(ownsAnyCourse: boolean): string {
  return ownsAnyCourse ? "/dashboard" : `/courses?${WELCOME_PARAM}=1`;
}

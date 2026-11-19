/**
 * Student login → admin login handoff for admin accounts with two-step verification. Only the email or
 * username moves, through this tab's sessionStorage (read once, then removed) — never the password, and
 * never the URL, so it stays out of browser history and server logs. Import-free so the Node test runner
 * can load it.
 */

export const ADMIN_LOGIN_HANDOFF_KEY = "eca.adminLoginIdentifier";
const MAX_IDENTIFIER = 254;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Whether the student login should offer "Go to admin login": only when the server answered that this
 * account must finish signing in with its authenticator, which it does for admin accounts alone.
 */
export function offerAdminLogin(res: { ok: boolean; mfaRequired?: boolean }): boolean {
  return !res.ok && res.mfaRequired === true;
}

/** Remembers the email or username for the admin login page in this tab. Takes nothing else. */
export function saveAdminLoginIdentifier(store: Store | null | undefined, identifier: string): void {
  const value = identifier.trim();
  if (!store || !value || value.length > MAX_IDENTIFIER) return;
  try {
    store.setItem(ADMIN_LOGIN_HANDOFF_KEY, value);
  } catch {
    // Storage blocked (private mode): the admin just types it again.
  }
}

/** Reads and removes the remembered email or username (empty when there is none). */
export function takeAdminLoginIdentifier(store: Store | null | undefined): string {
  if (!store) return "";
  try {
    const value = store.getItem(ADMIN_LOGIN_HANDOFF_KEY) ?? "";
    store.removeItem(ADMIN_LOGIN_HANDOFF_KEY);
    return value.length <= MAX_IDENTIFIER ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Helpers for the admin two-step verification pages. Import-free so the Node test runner can load it.
 */

/** A base32 setup key in groups of four, as authenticator apps display them: "ABCD EFGH IJKL …". */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

/** Where the admin area should send a session, from GET /auth/mfa/status. Null = allowed in. */
export function mfaRedirect(status: { enforced: boolean; enrolled: boolean; sessionVerified: boolean } | null): string | null {
  if (!status || !status.enforced || status.sessionVerified) return null;
  return status.enrolled ? "/admin/login?reason=mfa" : "/admin/mfa";
}

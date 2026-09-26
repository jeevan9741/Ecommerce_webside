import type { Role } from "./routes";

export interface TokenClaims {
  role?: Role;
  exp?: number;
}

/**
 * Reads the JWT's claims WITHOUT verifying the signature. That's deliberate and safe for its
 * callers (the proxy's redirects, the footer's links): they only decide what to link or where to
 * send someone, never serve data. Real authorisation happens on the backend for every API call,
 * and the dashboard/admin layouts re-validate the token with the backend before rendering.
 */
export function readClaims(token: string | undefined | null): TokenClaims | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as TokenClaims;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

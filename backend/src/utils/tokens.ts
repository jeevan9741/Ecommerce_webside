import { createHmac } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export type Role = "USER" | "ADMIN";

export interface SessionPayload {
  id: string;
  name: string;
  email: string;
  role: Role;
  referralCode: string;
}

/**
 * Ties a session to the password it was issued under: an HMAC of the stored password hash (keyed
 * with the server secret, so the token reveals nothing about the password). Changing the password
 * changes the fingerprint, which ends every session issued before the change.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHmac("sha256", env.jwtSecret).update(`session:${passwordHash}`).digest("base64url").slice(0, 22);
}

/**
 * Ties an admin session to the MFA factor it was verified with: an HMAC of the factor's id and enable
 * time. Resetting or replacing the factor changes it, which ends every MFA-verified session issued before.
 */
export function mfaFingerprint(factor: { id: string; enabledAt: Date }): string {
  return createHmac("sha256", env.jwtSecret).update(`mfa:${factor.id}:${factor.enabledAt.toISOString()}`).digest("base64url").slice(0, 22);
}

/**
 * Admin sessions (password-only or MFA-verified) last at most 12 hours, whatever JWT_EXPIRES_IN says;
 * other accounts keep JWT_EXPIRES_IN. The middleware also refuses older tokens of ADMIN accounts (see
 * ADMIN_SESSION_MAX_AGE_SECONDS), which covers tokens issued before this limit or before a promotion.
 */
export const ADMIN_SESSION_TTL = "12h";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** `mv` (MFA verified) is set only on sessions issued after a successful second factor. */
export function signSessionToken(user: SessionPayload, passwordHash: string, opts: { mv?: string } = {}): string {
  const admin = Boolean(opts.mv) || user.role === "ADMIN";
  return jwt.sign({ ...user, pv: passwordFingerprint(passwordHash), ...(opts.mv ? { mv: opts.mv } : {}) }, env.jwtSecret, {
    expiresIn: (admin ? ADMIN_SESSION_TTL : env.jwtExpiresIn) as SignOptions["expiresIn"],
  });
}

/**
 * After a correct password, an admin with MFA gets this 5-minute challenge instead of a session. It is
 * signed with a separate purpose and bound to the password fingerprint, so it can't be used as a session
 * and stops working if the password changes.
 */
const MFA_CHALLENGE_PURPOSE = "admin-mfa-challenge";
export function signMfaChallenge(userId: string, passwordHash: string): string {
  return jwt.sign({ sub: userId, purpose: MFA_CHALLENGE_PURPOSE, pv: passwordFingerprint(passwordHash) }, env.jwtSecret, { expiresIn: "5m" });
}
export function verifyMfaChallenge(token: unknown): { userId: string; pv: string } | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  try {
    const d = jwt.verify(token, env.jwtSecret) as { sub?: string; purpose?: string; pv?: string };
    return d.purpose === MFA_CHALLENGE_PURPOSE && typeof d.sub === "string" && typeof d.pv === "string" ? { userId: d.sub, pv: d.pv } : null;
  } catch {
    return null;
  }
}

export interface DecodedSession {
  session: SessionPayload;
  /** Password fingerprint; absent on tokens issued before fingerprints existed. */
  pv: string | null;
  /** Issued-at, in seconds. */
  iat: number;
  /** MFA fingerprint when the session was issued after a second factor; null otherwise. */
  mv: string | null;
}

/** Checks the signature and expiry only; the middleware still checks the session against the database. */
export function decodeSessionToken(token: string): DecodedSession | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as SessionPayload & { iat: number; exp: number; pv?: unknown; mv?: unknown; purpose?: unknown };
    if (decoded.purpose !== undefined) return null; // a challenge or other purpose token is never a session
    return {
      session: {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role,
        referralCode: decoded.referralCode,
      },
      pv: typeof decoded.pv === "string" ? decoded.pv : null,
      iat: decoded.iat,
      mv: typeof decoded.mv === "string" ? decoded.mv : null,
    };
  } catch {
    return null;
  }
}

/**
 * Replaces the old httpOnly "verified email" cookie. After a correct OTP the API hands
 * the client this short-lived signed token, and registration must present it — same
 * rule as before (no account without a verified email), but it survives the
 * frontend and backend living on different origins.
 */
const VERIFICATION_TTL = "30m";
const VERIFICATION_PURPOSE = "email-verified";

export function signEmailVerificationToken(email: string): string {
  return jwt.sign({ email: email.toLowerCase(), purpose: VERIFICATION_PURPOSE }, env.emailVerificationSecret, {
    expiresIn: VERIFICATION_TTL,
  });
}

export function verifyEmailVerificationToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.emailVerificationSecret) as { email: string; purpose: string };
    return decoded.purpose === VERIFICATION_PURPOSE ? decoded.email : null;
  } catch {
    return null;
  }
}

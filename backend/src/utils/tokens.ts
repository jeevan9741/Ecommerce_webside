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

export function signSessionToken(user: SessionPayload, passwordHash: string): string {
  return jwt.sign({ ...user, pv: passwordFingerprint(passwordHash) }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"],
  });
}

export interface DecodedSession {
  session: SessionPayload;
  /** Password fingerprint; absent on tokens issued before fingerprints existed. */
  pv: string | null;
  /** Issued-at, in seconds. */
  iat: number;
}

/** Checks the signature and expiry only; the middleware still checks the session against the database. */
export function decodeSessionToken(token: string): DecodedSession | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as SessionPayload & { iat: number; exp: number; pv?: unknown };
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

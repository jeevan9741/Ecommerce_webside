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

export function signSessionToken(user: SessionPayload): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as SessionPayload & { iat: number; exp: number };
    return {
      id: decoded.id,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
      referralCode: decoded.referralCode,
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

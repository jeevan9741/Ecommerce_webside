import crypto from "crypto";
import type { OtpPurpose } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { generateOtp, hashOtp } from "../utils/crypto.js";
import { sendEmail } from "./email.service.js";
import { HttpError } from "../utils/http.js";

/** Emailed 6-digit codes (EmailOtp): registration email checks and password resets. */

export const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
export const SEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Whether another code may be sent now: null when it may, otherwise the seconds to wait (0 when
 * the quota rather than the cooldown is the limit). DB-backed so it holds across server instances.
 */
export async function otpSendBlocked(email: string, purpose: OtpPurpose): Promise<{ retryAfterSeconds: number | null } | null> {
  const recentSends = await prisma.emailOtp.findMany({
    where: { email, purpose, createdAt: { gt: new Date(Date.now() - SEND_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastSentAt = recentSends[0]?.createdAt;
  if (lastSentAt) {
    const elapsedMs = Date.now() - lastSentAt.getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) return { retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000) };
  }
  if (recentSends.length >= MAX_SENDS_PER_WINDOW) return { retryAfterSeconds: null };
  return null;
}

/** Creates a fresh code (voiding any outstanding one) and emails it. Throws 502 if the email can't be sent. */
export async function createAndSendOtp(email: string, purpose: OtpPurpose, mail: { subject: string; html: (code: string) => string }) {
  const code = generateOtp();
  const codeHash = hashOtp(code, email);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // A resend must invalidate any still-outstanding code so only the newest one can verify.
  await prisma.emailOtp.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  const otp = await prisma.emailOtp.create({ data: { email, purpose, codeHash, expiresAt } });

  try {
    await sendEmail({ to: email, subject: mail.subject, html: mail.html(code) });
  } catch (err) {
    // Safe to log: provider/config messages only — never the code, API key or recipient's code.
    console.error(`Failed to send ${purpose} email:`, err instanceof Error ? err.message : err);
    // The email never went out, so this attempt must not count toward the resend cooldown/quota.
    await prisma.emailOtp.delete({ where: { id: otp.id } }).catch(() => undefined);
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a moment.");
  }
}

/** Checks a code against the newest outstanding one and consumes it. Throws 400 on any failure. */
export async function consumeOtp(email: string, purpose: OtpPurpose, code: string) {
  const otp = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date()) throw new HttpError(400, "Code expired. Please request a new one.");
  if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(400, "Too many incorrect attempts. Please request a new code.");

  if (!hashesMatch(hashOtp(code, email), otp.codeHash)) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, "Incorrect code.");
  }

  // Conditional so two requests racing with the same code can't both succeed.
  const { count } = await prisma.emailOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (!count) throw new HttpError(400, "Code expired. Please request a new one.");
}

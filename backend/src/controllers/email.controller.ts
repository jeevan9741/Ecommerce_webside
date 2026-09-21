import crypto from "crypto";
import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendOtpSchema, verifyOtpSchema } from "../utils/validation.js";
import { generateOtp, hashOtp } from "../utils/crypto.js";
import { sendEmail, otpEmailTemplate } from "../services/email.service.js";
import { rateLimit } from "../utils/rate-limit.js";
import { HttpError } from "../utils/http.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../utils/tokens.js";

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 10 * 60 * 1000;

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function sendOtp(req: Request, res: Response) {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { email, purpose } = parsed.data;

  // Cooldown and per-email quota are DB-backed so they hold across multiple server instances.
  const recentSends = await prisma.emailOtp.findMany({
    where: { email, purpose, createdAt: { gt: new Date(Date.now() - SEND_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const lastSentAt = recentSends[0]?.createdAt;
  if (lastSentAt) {
    const elapsedMs = Date.now() - lastSentAt.getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      throw new HttpError(429, `Please wait ${retryAfterSeconds}s before requesting another code.`, { retryAfterSeconds });
    }
  }
  if (recentSends.length >= MAX_SENDS_PER_WINDOW) {
    throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
  }

  // Best-effort secondary guard; in-memory, so not relied on as the primary control.
  if (!rateLimit(`otp-ip:${req.ip ?? "unknown"}`, 20, SEND_WINDOW_MS)) {
    throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
  }

  const code = generateOtp();
  const codeHash = hashOtp(code, email);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    // A resend must invalidate any still-outstanding code so only the newest one can verify.
    await prisma.emailOtp.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await prisma.emailOtp.create({ data: { email, purpose, codeHash, expiresAt } });
    await sendEmail({ to: email, subject: "Verify Your Email - E-Commerce Training Academy", html: otpEmailTemplate(code) });
  } catch (err) {
    console.error("Failed to send verification email:", err instanceof Error ? err.message : err);
    throw new HttpError(500, "Failed to send verification email. Please try again shortly.");
  }

  res.json({ ok: true, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 });
}

export async function verifyOtp(req: Request, res: Response) {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { email, code, purpose } = parsed.data;

  if (!rateLimit(`otp-verify:${email}`, 8, 10 * 60 * 1000)) {
    throw new HttpError(429, "Too many attempts. Please request a new code.");
  }

  const otp = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date()) throw new HttpError(400, "Code expired. Please request a new one.");
  if (otp.attempts >= 5) throw new HttpError(400, "Too many incorrect attempts. Please request a new code.");

  if (!hashesMatch(hashOtp(code, email), otp.codeHash)) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(400, "Incorrect code.");
  }

  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  // Replaces the old httpOnly cookie: the client holds this and presents it to /auth/register.
  res.json({ ok: true, verificationToken: signEmailVerificationToken(email) });
}

/** Lets the register page resume after a reload: confirms a stored token is still valid. */
export async function verifiedStatus(req: Request, res: Response) {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  res.json({ email: verifyEmailVerificationToken(token) });
}

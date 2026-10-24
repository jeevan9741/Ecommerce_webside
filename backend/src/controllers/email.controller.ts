import type { Request, Response } from "express";
import { sendOtpSchema, verifyOtpSchema } from "../utils/validation.js";
import { otpEmailTemplate } from "../services/email.service.js";
import { RESEND_COOLDOWN_MS, SEND_WINDOW_MS, consumeOtp, createAndSendOtp, otpSendBlocked } from "../services/otp.service.js";
import { rateLimit } from "../utils/rate-limit.js";
import { HttpError } from "../utils/http.js";
import { signEmailVerificationToken, verifyEmailVerificationToken } from "../utils/tokens.js";

export async function sendOtp(req: Request, res: Response) {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { email, purpose } = parsed.data;

  const blocked = await otpSendBlocked(email, purpose);
  if (blocked?.retryAfterSeconds) {
    throw new HttpError(429, `Please wait ${blocked.retryAfterSeconds}s before requesting another code.`, {
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
  }
  if (blocked) throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");

  // Best-effort secondary guard; in-memory, so not relied on as the primary control.
  if (!rateLimit(`otp-ip:${req.ip ?? "unknown"}`, 20, SEND_WINDOW_MS)) {
    throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
  }

  await createAndSendOtp(email, purpose, { subject: "Verify Your Email - E-Commerce Training Academy", html: otpEmailTemplate });
  res.json({ ok: true, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 });
}

export async function verifyOtp(req: Request, res: Response) {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { email, code, purpose } = parsed.data;

  if (!rateLimit(`otp-verify:${email}`, 8, 10 * 60 * 1000)) {
    throw new HttpError(429, "Too many attempts. Please request a new code.");
  }

  await consumeOtp(email, purpose, code);

  // Replaces the old httpOnly cookie: the client holds this and presents it to /auth/register.
  res.json({ ok: true, verificationToken: signEmailVerificationToken(email) });
}

/** Lets the register page resume after a reload: confirms a stored token is still valid. */
export async function verifiedStatus(req: Request, res: Response) {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  res.json({ email: verifyEmailVerificationToken(token) });
}

import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { forgotPasswordSchema, registerSchema, resetPasswordSchema } from "../utils/validation.js";
import { generateReferralCode } from "../utils/crypto.js";
import { HttpError } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { passwordResetEmailTemplate } from "../services/email.service.js";
import { RESEND_COOLDOWN_MS, SEND_WINDOW_MS, consumeOtp, createAndSendOtp, otpSendBlocked } from "../services/otp.service.js";
import { signSessionToken, verifyEmailVerificationToken, type SessionPayload } from "../utils/tokens.js";
import { currentUser } from "../middleware/auth.middleware.js";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

function toSession(user: { id: string; name: string; email: string; role: string; referralCode: string }): SessionPayload {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as SessionPayload["role"],
    referralCode: user.referralCode,
  };
}

/** Mirrors the former NextAuth Credentials authorize(): email or username, bcrypt, verified email. */
export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Please enter your email/username and password.");

  const identifier = parsed.data.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
  });

  // Same generic message for unknown user and bad password — never reveal which one failed.
  const invalid = new HttpError(401, "Invalid email/username or password.");
  if (!user) throw invalid;
  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) throw invalid;
  if (!user.emailVerified) throw new HttpError(403, "Please verify your email address first.");

  const session = toSession(user);
  res.json({ token: signSessionToken(session, user.passwordHash), user: session });
}

/** Returns the current session from the bearer token, refreshed from the DB so role/name changes apply. */
export async function session(req: Request, res: Response) {
  const tokenUser = currentUser(req);
  const user = await prisma.user.findUnique({ where: { id: tokenUser.id } });
  if (!user) throw new HttpError(401, "Sign in required");
  res.json({ user: toSession(user) });
}

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  }
  const { name, email, phone, username, password, referralCode, preferredLanguageCode } = parsed.data;

  const verifiedEmail = verifyEmailVerificationToken(req.body?.verificationToken);
  if (!verifiedEmail || verifiedEmail !== email.toLowerCase()) {
    throw new HttpError(403, "Please verify your email before creating an account.");
  }

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) {
    throw new HttpError(409, existing.email === email ? "An account with this email already exists." : "Username is taken.");
  }

  let referrerNote: string | null = null;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    referrerNote = referrer ? referrer.id : null;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let code = generateReferralCode(email);
  // Extremely unlikely collision, but guard anyway.
  for (let i = 0; i < 5; i++) {
    const clash = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!clash) break;
    code = generateReferralCode(email + i);
  }

  let preferredLanguageId: string | undefined;
  if (preferredLanguageCode) {
    const language = await prisma.language.findUnique({ where: { code: preferredLanguageCode } });
    preferredLanguageId = language?.id;
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      username,
      passwordHash,
      referralCode: code,
      emailVerified: new Date(),
      preferredLanguageId,
    },
  });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "USER_REGISTERED", target: user.id, metadata: { referrerId: referrerNote } },
  });

  // Signs the user straight in, same as the old post-registration signIn() call.
  const session = toSession(user);
  res.json({ ok: true, token: signSessionToken(session, user.passwordHash), user: session });
}

/**
 * Step 1 of a password reset: emails a 6-digit code. Answers the same way whether or not the email
 * has an account (and stays quiet when the resend cooldown applies), so it can't be used to find
 * out who is registered. The page enforces the cooldown on its side.
 */
export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Please enter a valid email address.");
  const { email } = parsed.data;

  if (!rateLimit(`password-reset-ip:${req.ip ?? "unknown"}`, 20, SEND_WINDOW_MS)) {
    throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
  }

  const reply = { ok: true, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user || (await otpSendBlocked(email, "LOGIN_RESET"))) {
    res.json(reply);
    return;
  }

  await createAndSendOtp(email, "LOGIN_RESET", {
    subject: "Reset Your Password - E-Commerce Training Academy",
    html: passwordResetEmailTemplate,
  });
  res.json(reply);
}

/** Step 2: checks the emailed code, sets the new password and signs the user in. */
export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const { email, code, password } = parsed.data;

  if (!rateLimit(`password-reset-verify:${email}`, 8, 10 * 60 * 1000)) {
    throw new HttpError(429, "Too many attempts. Please request a new code.");
  }

  await consumeOtp(email, "LOGIN_RESET", code);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
  if (!existing) throw new HttpError(400, "Code expired. Please request a new one.");

  const user = await prisma.user.update({
    where: { id: existing.id },
    // The code proves they own the address, so it counts as verified too.
    data: { passwordHash: await bcrypt.hash(password, 12), emailVerified: existing.emailVerified ?? new Date() },
  });
  await prisma.auditLog.create({ data: { actorId: user.id, action: "PASSWORD_RESET", target: user.id } });

  const session = toSession(user);
  res.json({ ok: true, token: signSessionToken(session, user.passwordHash), user: session });
}

import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { registerSchema } from "../utils/validation.js";
import { generateReferralCode } from "../utils/crypto.js";
import { HttpError } from "../utils/http.js";
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
  res.json({ token: signSessionToken(session), user: session });
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
  res.json({ ok: true, token: signSessionToken(session), user: session });
}

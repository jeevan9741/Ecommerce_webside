import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation";
import { generateReferralCode } from "@/lib/crypto";
import { isEmailVerified } from "@/lib/verified-email-cookie";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { name, email, phone, username, password, referralCode, preferredLanguageCode } = parsed.data;

  const verified = await isEmailVerified(email);
  if (!verified) {
    return NextResponse.json({ error: "Please verify your email before creating an account." }, { status: 403 });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    return NextResponse.json(
      { error: existing.email === email ? "An account with this email already exists." : "Username is taken." },
      { status: 409 }
    );
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
    data: {
      actorId: user.id,
      action: "USER_REGISTERED",
      target: user.id,
      metadata: { referrerId: referrerNote },
    },
  });

  return NextResponse.json({ ok: true });
}

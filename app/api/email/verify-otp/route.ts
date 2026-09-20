import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOtpSchema } from "@/lib/validation";
import { hashOtp } from "@/lib/crypto";
import { setVerifiedEmailCookie } from "@/lib/verified-email-cookie";
import { rateLimit } from "@/lib/rate-limit";

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = verifyOtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, code, purpose } = parsed.data;

  if (!rateLimit(`otp-verify:${email}`, 8, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please request a new code." }, { status: 429 });
  }

  const otp = await prisma.emailOtp.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp || otp.expiresAt < new Date()) {
    return NextResponse.json({ error: "Code expired. Please request a new one." }, { status: 400 });
  }

  if (otp.attempts >= 5) {
    return NextResponse.json({ error: "Too many incorrect attempts. Please request a new code." }, { status: 400 });
  }

  const candidateHash = hashOtp(code, email);
  if (!hashesMatch(candidateHash, otp.codeHash)) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await setVerifiedEmailCookie(email);

  return NextResponse.json({ ok: true });
}

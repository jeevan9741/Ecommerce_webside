import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpSchema } from "@/lib/validation";
import { generateOtp, hashOtp } from "@/lib/crypto";
import { sendEmail, otpEmailTemplate } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = sendOtpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, purpose } = parsed.data;

  // Cooldown and per-email quota are backed by the EmailOtp table (not in-memory) so they hold
  // up across Vercel's separate serverless instances, unlike a per-process rate-limit map.
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
      return NextResponse.json(
        { error: `Please wait ${retryAfterSeconds}s before requesting another code.`, retryAfterSeconds },
        { status: 429 }
      );
    }
  }

  if (recentSends.length >= MAX_SENDS_PER_WINDOW) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  // Best-effort secondary guard against a single IP hammering many different email addresses;
  // in-memory only, so it's not relied on as the primary control (the DB checks above are).
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`otp-ip:${ip}`, 20, SEND_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const code = generateOtp();
  const codeHash = hashOtp(code, email);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  try {
    // A resend must invalidate any still-outstanding code so only the newest one can ever verify.
    await prisma.emailOtp.updateMany({
      where: { email, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await prisma.emailOtp.create({ data: { email, purpose, codeHash, expiresAt } });

    await sendEmail({
      to: email,
      subject: "Verify Your Email - E-Commerce Training Academy",
      html: otpEmailTemplate(code),
    });
  } catch (err) {
    console.error("Failed to send verification email:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to send verification email. Please try again shortly." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 });
}

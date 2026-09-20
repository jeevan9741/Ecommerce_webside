import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { withdrawalRequestSchema } from "@/lib/validation";
import { getPartnerBalance } from "@/lib/commission";
import { rateLimit } from "@/lib/rate-limit";

export async function GET() {
  try {
    const user = await requireUser();
    const withdrawals = await prisma.withdrawalRequest.findMany({
      where: { partnerId: user.id },
      orderBy: { requestedAt: "desc" },
      include: { payoutMethod: { select: { type: true, label: true } } },
    });
    return NextResponse.json({ withdrawals });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to load withdrawals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    if (!rateLimit(`withdraw:${user.id}`, 5, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many withdrawal requests. Try again later." }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = withdrawalRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { payoutMethodId, amountInPaise } = parsed.data;

    const method = await prisma.payoutMethod.findUnique({ where: { id: payoutMethodId } });
    if (!method || method.userId !== user.id) {
      return NextResponse.json({ error: "Payout method not found" }, { status: 404 });
    }

    // Server-side balance check — the client-submitted amount is never trusted on its own.
    const { availableInPaise } = await getPartnerBalance(user.id);
    if (amountInPaise > availableInPaise) {
      return NextResponse.json({ error: "Amount exceeds available balance" }, { status: 400 });
    }
    if (amountInPaise < 10000) {
      return NextResponse.json({ error: "Minimum withdrawal amount is ₹100" }, { status: 400 });
    }

    const withdrawal = await prisma.withdrawalRequest.create({
      data: { partnerId: user.id, payoutMethodId, amountInPaise, status: "PENDING" },
    });

    await prisma.auditLog.create({
      data: { actorId: user.id, action: "WITHDRAWAL_REQUESTED", target: withdrawal.id, metadata: { amountInPaise } },
    });

    return NextResponse.json({ withdrawal });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Failed to submit withdrawal request" }, { status: 500 });
  }
}

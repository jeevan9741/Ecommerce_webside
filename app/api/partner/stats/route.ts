import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { getPartnerBalance, getPartnerEarningsBreakdown } from "@/lib/commission";

export async function GET() {
  try {
    const user = await requireUser();

    const [balance, earnings, referralCount, sales, pending] = await Promise.all([
      getPartnerBalance(user.id),
      getPartnerEarningsBreakdown(user.id),
      prisma.order.count({ where: { referrerUserId: user.id, status: "PAID" } }),
      prisma.commissionLedger.findMany({
        where: { partnerId: user.id },
        include: { order: { include: { course: true, user: { select: { name: true, email: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.commissionLedger.aggregate({
        where: { partnerId: user.id, status: "PENDING" },
        _sum: { amountInPaise: true },
      }),
    ]);

    return NextResponse.json({
      referralCode: user.referralCode,
      balance,
      earnings,
      pendingInPaise: pending._sum.amountInPaise ?? 0,
      referralCount,
      sales: sales.map((s) => ({
        id: s.id,
        amountInPaise: s.amountInPaise,
        status: s.status,
        createdAt: s.createdAt,
        courseTitle: s.order.course.title,
        customerName: s.order.user.name,
      })),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Failed to load partner stats" }, { status: 500 });
  }
}

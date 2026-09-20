import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [todayPayouts, totalPaid, pending, successCount, failedCount] = await Promise.all([
      prisma.withdrawalRequest.aggregate({
        where: { status: "SUCCESS", processedAt: { gte: startOfDay } },
        _sum: { amountInPaise: true },
      }),
      prisma.withdrawalRequest.aggregate({
        where: { status: "SUCCESS" },
        _sum: { amountInPaise: true },
      }),
      prisma.withdrawalRequest.aggregate({
        where: { status: { in: ["PENDING", "PROCESSING"] } },
        _sum: { amountInPaise: true },
        _count: true,
      }),
      prisma.withdrawalRequest.count({ where: { status: "SUCCESS" } }),
      prisma.withdrawalRequest.count({ where: { status: "FAILED" } }),
    ]);

    return NextResponse.json({
      todayPayoutsInPaise: todayPayouts._sum.amountInPaise ?? 0,
      totalPaidInPaise: totalPaid._sum.amountInPaise ?? 0,
      pendingInPaise: pending._sum.amountInPaise ?? 0,
      pendingCount: pending._count,
      successCount,
      failedCount,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load payout analytics" }, { status: 500 });
  }
}

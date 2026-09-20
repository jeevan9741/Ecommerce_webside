import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireAdmin();
    const withdrawals = await prisma.withdrawalRequest.findMany({
      orderBy: { requestedAt: "desc" },
      include: {
        partner: { select: { name: true, email: true, referralCode: true } },
        payoutMethod: { select: { type: true, label: true } },
      },
    });
    return NextResponse.json({ withdrawals });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load withdrawals" }, { status: 500 });
  }
}

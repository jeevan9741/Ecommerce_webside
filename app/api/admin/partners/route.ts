import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { getPartnerBalance } from "@/lib/commission";

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      where: { role: "USER" },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        _count: { select: { referredOrders: true, commissions: true } },
      },
    });

    const partners = await Promise.all(
      users.map(async (u) => {
        const balance = await getPartnerBalance(u.id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          referralCode: u.referralCode,
          totalReferralOrders: u._count.referredOrders,
          creditedTotal: balance.creditedTotal,
          availableInPaise: balance.availableInPaise,
        };
      })
    );

    // Only surface partners who have actually referred at least one order or been credited.
    const active = partners.filter((p) => p.totalReferralOrders > 0 || p.creditedTotal > 0);

    return NextResponse.json({ partners: active });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load partners" }, { status: 500 });
  }
}

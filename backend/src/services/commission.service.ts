import { prisma } from "../config/prisma.js";

/** Available balance = CREDITED commissions minus everything already withdrawn
 * (PENDING/PROCESSING/SUCCESS withdrawals all lock funds; only FAILED releases them back). */
export async function getPartnerBalance(partnerId: string) {
  const [credited, locked] = await Promise.all([
    prisma.commissionLedger.aggregate({
      where: { partnerId, status: "CREDITED" },
      _sum: { amountInPaise: true },
    }),
    prisma.withdrawalRequest.aggregate({
      where: { partnerId, status: { in: ["PENDING", "PROCESSING", "SUCCESS"] } },
      _sum: { amountInPaise: true },
    }),
  ]);

  const creditedTotal = credited._sum.amountInPaise ?? 0;
  const lockedTotal = locked._sum.amountInPaise ?? 0;

  return {
    creditedTotal,
    lockedTotal,
    availableInPaise: Math.max(0, creditedTotal - lockedTotal),
  };
}

export async function getPartnerEarningsBreakdown(partnerId: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumSince = async (since: Date) =>
    (
      await prisma.commissionLedger.aggregate({
        where: { partnerId, status: "CREDITED", createdAt: { gte: since } },
        _sum: { amountInPaise: true },
      })
    )._sum.amountInPaise ?? 0;

  const [today, week, month, lifetime] = await Promise.all([
    sumSince(startOfDay),
    sumSince(startOfWeek),
    sumSince(startOfMonth),
    prisma.commissionLedger
      .aggregate({ where: { partnerId, status: "CREDITED" }, _sum: { amountInPaise: true } })
      .then((r) => r._sum.amountInPaise ?? 0),
  ]);

  return { today, week, month, lifetime };
}

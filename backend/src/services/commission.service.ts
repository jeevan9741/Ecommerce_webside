import { prisma } from "../config/prisma.js";

/** Commission from admin-approved referral claims, optionally only those approved since a date. */
async function approvedClaimsTotal(partnerId: string, since?: Date) {
  const r = await prisma.referralClaim.aggregate({
    where: { partnerId, status: "APPROVED", ...(since ? { reviewedAt: { gte: since } } : {}) },
    _sum: { commissionInPaise: true },
  });
  return r._sum.commissionInPaise ?? 0;
}

/** Available balance = CREDITED commissions (plus approved referral claims) minus everything already
 * withdrawn (PENDING/PROCESSING/SUCCESS withdrawals all lock funds; only FAILED releases them back). */
export async function getPartnerBalance(partnerId: string) {
  const [credited, claimed, locked] = await Promise.all([
    prisma.commissionLedger.aggregate({
      where: { partnerId, status: "CREDITED" },
      _sum: { amountInPaise: true },
    }),
    approvedClaimsTotal(partnerId),
    prisma.withdrawalRequest.aggregate({
      where: { partnerId, status: { in: ["PENDING", "PROCESSING", "SUCCESS"] } },
      _sum: { amountInPaise: true },
    }),
  ]);

  const creditedTotal = (credited._sum.amountInPaise ?? 0) + claimed;
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

  const sumSince = async (since?: Date) => {
    const [ledger, claims] = await Promise.all([
      prisma.commissionLedger.aggregate({
        where: { partnerId, status: "CREDITED", ...(since ? { createdAt: { gte: since } } : {}) },
        _sum: { amountInPaise: true },
      }),
      approvedClaimsTotal(partnerId, since),
    ]);
    return (ledger._sum.amountInPaise ?? 0) + claims;
  };

  const [today, week, month, lifetime] = await Promise.all([
    sumSince(startOfDay),
    sumSince(startOfWeek),
    sumSince(startOfMonth),
    sumSince(),
  ]);

  return { today, week, month, lifetime };
}

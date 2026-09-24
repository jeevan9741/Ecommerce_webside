import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { payoutMethodSchema, referralClaimSchema, withdrawalRequestSchema } from "../utils/validation.js";
import { encryptJson } from "../utils/crypto.js";
import { getPartnerBalance, getPartnerEarningsBreakdown } from "../services/commission.service.js";
import { rateLimit } from "../utils/rate-limit.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError } from "../utils/http.js";

export async function partnerStats(req: Request, res: Response) {
  const user = currentUser(req);

  const [balance, earnings, referralCount, sales, pending, ledgerCounts, claimCounts] = await Promise.all([
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
    prisma.commissionLedger.groupBy({ by: ["status"], where: { partnerId: user.id }, _count: true }),
    prisma.referralClaim.groupBy({ by: ["status"], where: { partnerId: user.id }, _count: true }),
  ]);

  const countOf = (rows: { status: string; _count: number }[], status: string) =>
    rows.find((r) => r.status === status)?._count ?? 0;

  res.json({
    referralCode: user.referralCode,
    balance,
    earnings,
    pendingInPaise: pending._sum.amountInPaise ?? 0,
    referralCount,
    // Sales = referral-link commissions plus UTR claims, so the portal card shows one combined figure.
    approvedSales: countOf(ledgerCounts, "CREDITED") + countOf(claimCounts, "APPROVED"),
    pendingApprovals: countOf(ledgerCounts, "PENDING") + countOf(claimCounts, "PENDING"),
    sales: sales.map((s) => ({
      id: s.id,
      amountInPaise: s.amountInPaise,
      status: s.status,
      createdAt: s.createdAt,
      courseTitle: s.order.course.title,
      customerName: s.order.user.name,
    })),
  });
}

export async function listPayoutMethods(req: Request, res: Response) {
  const user = currentUser(req);
  const methods = await prisma.payoutMethod.findMany({
    where: { userId: user.id },
    select: { id: true, type: true, label: true, isDefault: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ methods });
}

export async function createPayoutMethod(req: Request, res: Response) {
  const user = currentUser(req);
  const parsed = payoutMethodSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid payout details");
  const { type, label, ...details } = parsed.data;

  const method = await prisma.payoutMethod.create({
    data: { userId: user.id, type, label, encryptedDetails: encryptJson(details) },
    select: { id: true, type: true, label: true, createdAt: true },
  });
  res.json({ method });
}

export async function listWithdrawals(req: Request, res: Response) {
  const user = currentUser(req);
  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { partnerId: user.id },
    orderBy: { requestedAt: "desc" },
    include: { payoutMethod: { select: { type: true, label: true } } },
  });
  res.json({ withdrawals });
}

export async function createWithdrawal(req: Request, res: Response) {
  const user = currentUser(req);

  if (!rateLimit(`withdraw:${user.id}`, 5, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many withdrawal requests. Try again later.");
  }

  const parsed = withdrawalRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { payoutMethodId, amountInPaise } = parsed.data;

  const method = await prisma.payoutMethod.findUnique({ where: { id: payoutMethodId } });
  if (!method || method.userId !== user.id) throw new HttpError(404, "Payout method not found");

  if (amountInPaise < 10000) throw new HttpError(400, "Minimum withdrawal amount is ₹100");

  // Server-side balance check — the client-submitted amount is never trusted on its own. The
  // per-partner advisory lock makes check-then-insert atomic, so two simultaneous requests can't
  // both pass against the same balance.
  const withdrawal = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`withdraw:${user.id}`}))`;
    const { availableInPaise } = await getPartnerBalance(user.id, tx);
    if (amountInPaise > availableInPaise) throw new HttpError(400, "Amount exceeds available balance");
    return tx.withdrawalRequest.create({
      data: { partnerId: user.id, payoutMethodId, amountInPaise, status: "PENDING" },
    });
  });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "WITHDRAWAL_REQUESTED", target: withdrawal.id, metadata: { amountInPaise } },
  });

  res.json({ withdrawal });
}

export async function createReferralClaim(req: Request, res: Response) {
  const user = currentUser(req);

  if (!rateLimit(`referral-claim:${user.id}`, 10, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many claims submitted. Try again later.");
  }

  const parsed = referralClaimSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const { studentName, studentPhone, courseId, utr } = parsed.data;

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { isActive: true } });
  if (!course?.isActive) throw new HttpError(400, "Please choose a valid package");

  // UTRs are globally unique, so one payment can only ever be claimed once — by anyone.
  const existing = await prisma.referralClaim.findUnique({ where: { utr }, select: { id: true } });
  if (existing) throw new HttpError(409, "This UTR has already been claimed");

  const claim = await prisma.referralClaim
    .create({
      data: { partnerId: user.id, studentName, studentPhone, courseId, utr },
      include: { course: { select: { title: true, type: true } } },
    })
    .catch((err: { code?: string }) => {
      // Lost a race with a concurrent claim for the same UTR — the unique index caught it.
      if (err.code === "P2002") throw new HttpError(409, "This UTR has already been claimed");
      throw err;
    });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "REFERRAL_CLAIM_SUBMITTED", target: claim.id, metadata: { utr } },
  });

  res.status(201).json({ claim });
}

export async function listMyReferralClaims(req: Request, res: Response) {
  const user = currentUser(req);
  const claims = await prisma.referralClaim.findMany({
    where: { partnerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      studentName: true,
      utr: true,
      status: true,
      commissionInPaise: true,
      adminNote: true,
      createdAt: true,
      course: { select: { title: true, type: true } },
    },
  });
  res.json({ claims });
}

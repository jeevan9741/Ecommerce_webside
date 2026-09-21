import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { payoutMethodSchema, withdrawalRequestSchema } from "../utils/validation.js";
import { encryptJson } from "../utils/crypto.js";
import { getPartnerBalance, getPartnerEarningsBreakdown } from "../services/commission.service.js";
import { rateLimit } from "../utils/rate-limit.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError } from "../utils/http.js";

export async function partnerStats(req: Request, res: Response) {
  const user = currentUser(req);

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

  res.json({
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

  // Server-side balance check — the client-submitted amount is never trusted on its own.
  const { availableInPaise } = await getPartnerBalance(user.id);
  if (amountInPaise > availableInPaise) throw new HttpError(400, "Amount exceeds available balance");
  if (amountInPaise < 10000) throw new HttpError(400, "Minimum withdrawal amount is ₹100");

  const withdrawal = await prisma.withdrawalRequest.create({
    data: { partnerId: user.id, payoutMethodId, amountInPaise, status: "PENDING" },
  });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: "WITHDRAWAL_REQUESTED", target: withdrawal.id, metadata: { amountInPaise } },
  });

  res.json({ withdrawal });
}

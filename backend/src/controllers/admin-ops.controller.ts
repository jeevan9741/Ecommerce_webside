import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { getPartnerBalance } from "../services/commission.service.js";
import { attemptAutomatedPayout } from "../services/payout.service.js";
import { reconcileOrderWithRazorpay } from "../services/order.service.js";
import { RazorpayConfigError } from "../services/razorpay.service.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";

// ---------- Analytics ----------

export async function salesAnalytics(_req: Request, res: Response) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumSince = (since?: Date) =>
    prisma.order.aggregate({
      where: { status: "PAID", ...(since ? { paidAt: { gte: since } } : {}) },
      _sum: { amountInPaise: true },
      _count: true,
    });

  const [today, week, month, total, byCourse] = await Promise.all([
    sumSince(startOfDay),
    sumSince(startOfWeek),
    sumSince(startOfMonth),
    sumSince(),
    prisma.order.groupBy({
      by: ["courseId"],
      where: { status: "PAID" },
      _sum: { amountInPaise: true },
      _count: true,
    }),
  ]);

  const courses = await prisma.course.findMany({
    where: { id: { in: byCourse.map((c) => c.courseId) } },
    select: { id: true, title: true, type: true },
  });
  const courseMap = new Map(courses.map((c) => [c.id, c]));

  res.json({
    today: { amountInPaise: today._sum.amountInPaise ?? 0, count: today._count },
    week: { amountInPaise: week._sum.amountInPaise ?? 0, count: week._count },
    month: { amountInPaise: month._sum.amountInPaise ?? 0, count: month._count },
    total: { amountInPaise: total._sum.amountInPaise ?? 0, count: total._count },
    byCourse: byCourse.map((c) => ({
      courseId: c.courseId,
      title: courseMap.get(c.courseId)?.title ?? "Unknown",
      type: courseMap.get(c.courseId)?.type,
      amountInPaise: c._sum.amountInPaise ?? 0,
      count: c._count,
    })),
  });
}

export async function payoutAnalytics(_req: Request, res: Response) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [todayPayouts, totalPaid, pending, successCount, failedCount] = await Promise.all([
    prisma.withdrawalRequest.aggregate({
      where: { status: "SUCCESS", processedAt: { gte: startOfDay } },
      _sum: { amountInPaise: true },
    }),
    prisma.withdrawalRequest.aggregate({ where: { status: "SUCCESS" }, _sum: { amountInPaise: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      _sum: { amountInPaise: true },
      _count: true,
    }),
    prisma.withdrawalRequest.count({ where: { status: "SUCCESS" } }),
    prisma.withdrawalRequest.count({ where: { status: "FAILED" } }),
  ]);

  res.json({
    todayPayoutsInPaise: todayPayouts._sum.amountInPaise ?? 0,
    totalPaidInPaise: totalPaid._sum.amountInPaise ?? 0,
    pendingInPaise: pending._sum.amountInPaise ?? 0,
    pendingCount: pending._count,
    successCount,
    failedCount,
  });
}

// ---------- People ----------

export async function listCustomers(_req: Request, res: Response) {
  const customers = await prisma.user.findMany({
    where: { role: "USER" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      referralCode: true,
      emailVerified: true,
      createdAt: true,
      orders: {
        where: { status: "PAID" },
        select: { amountInPaise: true, createdAt: true, referralCodeUsed: true, course: { select: { title: true } } },
      },
    },
  });
  res.json({ customers });
}

export async function listPartners(_req: Request, res: Response) {
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
  res.json({ partners: partners.filter((p) => p.totalReferralOrders > 0 || p.creditedTotal > 0) });
}

// ---------- Orders ----------

export async function listOrders(_req: Request, res: Response) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      course: { select: { title: true } },
      user: { select: { name: true, email: true } },
      access: { select: { id: true } },
    },
  });
  res.json({
    orders: orders.map((o) => ({
      id: o.id,
      courseTitle: o.course.title,
      customerName: o.user.name,
      customerEmail: o.user.email,
      amountInPaise: o.amountInPaise,
      status: o.status,
      razorpayOrderId: o.razorpayOrderId,
      razorpayPaymentId: o.razorpayPaymentId,
      hasAccess: Boolean(o.access),
      createdAt: o.createdAt,
      paidAt: o.paidAt,
    })),
  });
}

export async function syncOrder(req: Request, res: Response) {
  const order = await prisma.order.findUnique({ where: { id: param(req, "id") } });
  if (!order) throw new HttpError(404, "Order not found");
  try {
    res.json(await reconcileOrderWithRazorpay(order));
  } catch (err) {
    if (err instanceof RazorpayConfigError) return res.status(503).json({ error: err.message });
    console.error("[PAYMENT] Manual order sync failed:", err);
    return res.status(500).json({ error: "Failed to sync order with Razorpay" });
  }
}

// ---------- Withdrawals ----------

export async function listWithdrawals(_req: Request, res: Response) {
  const withdrawals = await prisma.withdrawalRequest.findMany({
    orderBy: { requestedAt: "desc" },
    include: {
      partner: { select: { name: true, email: true, referralCode: true } },
      payoutMethod: { select: { type: true, label: true } },
    },
  });
  res.json({ withdrawals });
}

const processWithdrawalSchema = z.object({
  action: z.enum(["SUCCESS", "FAILED", "PROCESSING"]),
  providerRefId: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function processWithdrawal(req: Request, res: Response) {
  const admin = currentUser(req);
  const id = param(req, "id");
  const parsed = processWithdrawalSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");

  const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!withdrawal) throw new HttpError(404, "Not found");

  if (parsed.data.action === "PROCESSING") await attemptAutomatedPayout(id);

  const updated = await prisma.withdrawalRequest.update({
    where: { id },
    data: {
      status: parsed.data.action,
      providerRefId: parsed.data.providerRefId,
      failureReason: parsed.data.failureReason,
      processedAt: parsed.data.action === "SUCCESS" || parsed.data.action === "FAILED" ? new Date() : undefined,
    },
  });

  await prisma.auditLog.create({
    data: { actorId: admin.id, action: `WITHDRAWAL_${parsed.data.action}`, target: id },
  });

  res.json({ withdrawal: updated });
}

// ---------- Site settings ----------

const settingSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.any(),
});

export async function listSettings(_req: Request, res: Response) {
  const settings = await prisma.siteSetting.findMany();
  res.json({ settings });
}

export async function saveSetting(req: Request, res: Response) {
  const parsed = settingSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const setting = await prisma.siteSetting.upsert({
    where: { key: parsed.data.key },
    update: { value: parsed.data.value },
    create: { key: parsed.data.key, value: parsed.data.value },
  });
  res.json({ setting });
}

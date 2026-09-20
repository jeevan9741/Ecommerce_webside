import { prisma } from "@/lib/prisma";
import { getRazorpayClient } from "@/lib/razorpay";
import type { Order } from "@prisma/client";

/**
 * Marks an order PAID, grants course access, and credits referral commission —
 * all inside one transaction so a retried webhook can never double-unlock or
 * double-credit. Safe to call multiple times for the same payment id.
 */
export async function markOrderPaid(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature?: string | null;
}) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = params;
  console.log("[PAYMENT] markOrderPaid start", { razorpayOrderId, razorpayPaymentId });

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { razorpayOrderId },
      include: { course: true },
    });
    if (!order) {
      console.error("[PAYMENT] markOrderPaid: no Order row matches this razorpayOrderId", { razorpayOrderId });
      return { ok: false as const, reason: "order_not_found" };
    }

    if (order.status === "PAID") {
      console.log("[PAYMENT] markOrderPaid: already processed (idempotent no-op)", { orderId: order.id });
      return { ok: true as const, alreadyProcessed: true };
    }
    if (order.status !== "CREATED") {
      console.error("[PAYMENT] markOrderPaid: order in unexpected status", { orderId: order.id, status: order.status });
      return { ok: false as const, reason: `order_in_status_${order.status}` };
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        razorpayPaymentId,
        razorpaySignature: razorpaySignature ?? undefined,
        paidAt: new Date(),
      },
    });
    console.log("[PAYMENT] Order marked PAID", { orderId: order.id });

    await tx.courseAccess.upsert({
      where: { userId_courseId: { userId: order.userId, courseId: order.courseId } },
      update: { revokedAt: null, languageGranted: order.selectedLanguage ?? undefined },
      create: {
        userId: order.userId,
        courseId: order.courseId,
        orderId: order.id,
        languageGranted: order.selectedLanguage,
      },
    });
    console.log("[PAYMENT] CourseAccess created/updated", { userId: order.userId, courseId: order.courseId });

    if (
      order.referrerUserId &&
      order.referrerUserId !== order.userId &&
      order.course.commissionInPaise > 0
    ) {
      await tx.commissionLedger.create({
        data: {
          partnerId: order.referrerUserId,
          orderId: order.id,
          amountInPaise: order.course.commissionInPaise,
          status: "CREDITED",
        },
      });
      console.log("[PAYMENT] Referral commission credited", {
        partnerId: order.referrerUserId,
        amountInPaise: order.course.commissionInPaise,
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: order.userId,
        action: "ORDER_PAID",
        target: order.id,
        metadata: { razorpayPaymentId },
      },
    });

    console.log("[PAYMENT] Access Granted", { orderId: order.id, userId: order.userId, courseId: order.courseId });
    return { ok: true as const, alreadyProcessed: false };
  });
}

/**
 * Reconciliation safety net shared by the customer's own status poll and the admin
 * "Sync" action: asks Razorpay directly (server-to-server, authoritative) whether an
 * order's payment actually captured, and if so, runs it through markOrderPaid — the
 * exact same unlock path the webhook uses. Never invents a second way to grant access.
 */
export async function reconcileOrderWithRazorpay(order: Pick<Order, "id" | "razorpayOrderId" | "status">) {
  if (order.status === "PAID") {
    return { synced: false as const, alreadyPaid: true as const };
  }

  const razorpay = getRazorpayClient();
  const payments = await razorpay.orders.fetchPayments(order.razorpayOrderId);
  console.log("[PAYMENT] Reconciliation — Razorpay payments for order", {
    orderId: order.id,
    razorpayOrderId: order.razorpayOrderId,
    statuses: payments.items.map((p) => ({ id: p.id, status: p.status })),
  });

  const captured = payments.items.find((p) => p.status === "captured");
  if (!captured) {
    return {
      synced: false as const,
      reason: "No captured payment found on Razorpay for this order yet.",
      payments: payments.items.map((p) => ({ id: p.id, status: p.status })),
    };
  }

  const result = await markOrderPaid({
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: captured.id,
  });

  await prisma.auditLog.create({
    data: {
      action: "ORDER_RECONCILED",
      target: order.id,
      metadata: { razorpayPaymentId: captured.id, result },
    },
  });

  return { synced: true as const, result };
}

export async function markOrderFailed(razorpayOrderId: string) {
  const result = await prisma.order.updateMany({
    where: { razorpayOrderId, status: "CREATED" },
    data: { status: "FAILED" },
  });
  console.log("[PAYMENT] markOrderFailed", { razorpayOrderId, matchedCount: result.count });
}

/** Refund/cancellation handling — revokes access and reverses any credited commission. */
export async function reverseOrder(razorpayPaymentId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { razorpayPaymentId } });
    if (!order || order.status !== "PAID") return { ok: false as const };

    await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });

    await tx.courseAccess.updateMany({
      where: { orderId: order.id },
      data: { revokedAt: new Date() },
    });

    await tx.commissionLedger.updateMany({
      where: { orderId: order.id, status: "CREDITED" },
      data: { status: "REVERSED", reason },
    });

    await tx.auditLog.create({
      data: { action: "ORDER_REFUNDED", target: order.id, metadata: { reason } },
    });

    return { ok: true as const };
  });
}

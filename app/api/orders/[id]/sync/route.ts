import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { RazorpayConfigError } from "@/lib/razorpay";
import { reconcileOrderWithRazorpay } from "@/lib/order-processing";

/**
 * Customer-facing self-heal: if the checkout page's status poll times out before the
 * webhook arrives (missed delivery, transient network issue), it calls this once to ask
 * Razorpay directly instead of leaving the customer stuck on a CREATED order forever.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await reconcileOrderWithRazorpay(order);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof RazorpayConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[PAYMENT] Customer order sync failed:", err);
    return NextResponse.json({ error: "Failed to check payment status" }, { status: 500 });
  }
}

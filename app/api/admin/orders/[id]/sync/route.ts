import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { RazorpayConfigError } from "@/lib/razorpay";
import { reconcileOrderWithRazorpay } from "@/lib/order-processing";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const result = await reconcileOrderWithRazorpay(order);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof RazorpayConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[PAYMENT] Manual order sync failed:", err);
    return NextResponse.json({ error: "Failed to sync order with Razorpay" }, { status: 500 });
  }
}

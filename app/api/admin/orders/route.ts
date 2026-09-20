import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireAdmin();
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        course: { select: { title: true } },
        user: { select: { name: true, email: true } },
        access: { select: { id: true } },
      },
    });
    return NextResponse.json({
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
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[PAYMENT] Failed to load admin orders list:", err);
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}

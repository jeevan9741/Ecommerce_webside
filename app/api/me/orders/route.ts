import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";

export async function GET() {
  try {
    const user = await requireUser();
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amountInPaise: true,
        status: true,
        selectedLanguage: true,
        createdAt: true,
        paidAt: true,
        course: { select: { title: true, type: true } },
      },
    });
    return NextResponse.json({ orders });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}

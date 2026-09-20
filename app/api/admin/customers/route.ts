import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
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
          select: {
            amountInPaise: true,
            createdAt: true,
            referralCodeUsed: true,
            course: { select: { title: true } },
          },
        },
      },
    });
    return NextResponse.json({ customers: users });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });
  }
}

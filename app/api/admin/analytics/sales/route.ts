import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const sumSince = async (since?: Date) =>
      (
        await prisma.order.aggregate({
          where: { status: "PAID", ...(since ? { paidAt: { gte: since } } : {}) },
          _sum: { amountInPaise: true },
          _count: true,
        })
      );

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

    return NextResponse.json({
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
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to load sales analytics" }, { status: 500 });
  }
}

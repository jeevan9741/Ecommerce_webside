import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { lessonSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: moduleId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = lessonSchema.pick({ title: true, displayOrder: true }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const last = await prisma.lesson.findFirst({ where: { moduleId }, orderBy: { displayOrder: "desc" } });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId,
        title: parsed.data.title,
        displayOrder: parsed.data.displayOrder ?? (last ? last.displayOrder + 1 : 0),
      },
    });
    return NextResponse.json({ lesson });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to create lesson:", err);
    return NextResponse.json({ error: "Failed to create lesson" }, { status: 500 });
  }
}

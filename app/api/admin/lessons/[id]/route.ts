import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { lessonSchema } from "@/lib/validation";
import { deleteObject } from "@/lib/storage";

const FIELDS = ["videoUrl", "subtitleUrl"] as const;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = lessonSchema.partial().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const existing = await prisma.lesson.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

    const lesson = await prisma.lesson.update({ where: { id }, data: parsed.data });

    // Replacing or clearing a video/subtitle field orphans its old blob — clean up now.
    for (const field of FIELDS) {
      const oldKey = existing[field];
      const newKey = parsed.data[field];
      if (oldKey && field in parsed.data && oldKey !== newKey) {
        await deleteObject(oldKey).catch((err) => console.error(`Failed to delete old lesson ${field} blob:`, err));
      }
    }

    return NextResponse.json({ lesson });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to update lesson:", err);
    return NextResponse.json({ error: "Failed to update lesson" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const lesson = await prisma.lesson.delete({ where: { id } });
    for (const field of FIELDS) {
      const key = lesson[field];
      if (key) await deleteObject(key).catch((err) => console.error(`Failed to delete lesson ${field} blob:`, err));
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to delete lesson:", err);
    return NextResponse.json({ error: "Failed to delete lesson" }, { status: 500 });
  }
}

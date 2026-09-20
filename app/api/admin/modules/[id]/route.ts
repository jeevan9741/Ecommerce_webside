import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { moduleSchema } from "@/lib/validation";
import { deleteObject } from "@/lib/storage";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = moduleSchema.partial().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const module_ = await prisma.module.update({ where: { id }, data: parsed.data, include: { lessons: true } });
    return NextResponse.json({ module: module_ });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to update module:", err);
    return NextResponse.json({ error: "Failed to update module" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;

    // Clean up every lesson's blob storage before the cascade delete removes the rows.
    const lessons = await prisma.lesson.findMany({ where: { moduleId: id } });
    for (const lesson of lessons) {
      if (lesson.videoUrl) await deleteObject(lesson.videoUrl).catch((err) => console.error("Failed to delete lesson video blob:", err));
      if (lesson.subtitleUrl) await deleteObject(lesson.subtitleUrl).catch((err) => console.error("Failed to delete lesson subtitle blob:", err));
    }

    await prisma.module.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to delete module:", err);
    return NextResponse.json({ error: "Failed to delete module" }, { status: 500 });
  }
}

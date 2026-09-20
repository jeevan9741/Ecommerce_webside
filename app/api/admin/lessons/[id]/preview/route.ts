import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { getDownloadUrl } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const lesson = await prisma.lesson.findUnique({ where: { id } });
    if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    if (!lesson.videoUrl) return NextResponse.json({ error: "No video uploaded for this lesson" }, { status: 404 });

    return NextResponse.json({
      videoUrl: await getDownloadUrl(lesson.videoUrl, 600),
      subtitleUrl: lesson.subtitleUrl ? await getDownloadUrl(lesson.subtitleUrl, 600) : null,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to create lesson preview URL:", err);
    return NextResponse.json({ error: "Failed to load preview" }, { status: 500 });
  }
}

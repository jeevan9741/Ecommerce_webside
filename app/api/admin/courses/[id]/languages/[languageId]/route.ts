import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { courseLanguageVideoSchema } from "@/lib/validation";
import { deleteObject } from "@/lib/storage";

const FIELDS = ["videoUrl", "subtitleUrl", "ebookUrl"] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; languageId: string }> }
) {
  try {
    await requireAdmin();
    const { id: courseId, languageId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = courseLanguageVideoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await prisma.courseLanguageVideo.findUnique({
      where: { courseId_languageId: { courseId, languageId } },
    });

    const entry = await prisma.courseLanguageVideo.upsert({
      where: { courseId_languageId: { courseId, languageId } },
      update: parsed.data,
      create: { courseId, languageId, ...parsed.data },
      include: { language: true },
    });

    // Replacing or clearing a field orphans its old blob — clean those up now that the DB write succeeded.
    if (existing) {
      for (const field of FIELDS) {
        const oldKey = existing[field];
        const newKey = parsed.data[field];
        if (oldKey && field in parsed.data && oldKey !== newKey) {
          await deleteObject(oldKey).catch((err) => console.error(`Failed to delete old ${field} blob:`, err));
        }
      }
    }

    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to save course language" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; languageId: string }> }
) {
  try {
    await requireAdmin();
    const { id: courseId, languageId } = await params;
    const existing = await prisma.courseLanguageVideo.delete({
      where: { courseId_languageId: { courseId, languageId } },
    });
    for (const field of FIELDS) {
      const key = existing[field];
      if (key) await deleteObject(key).catch((err) => console.error(`Failed to delete ${field} blob:`, err));
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to remove course language" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: courseId } = await params;
    const entries = await prisma.courseLanguageVideo.findMany({
      where: { courseId },
      include: { language: true },
      orderBy: { language: { displayOrder: "asc" } },
    });
    return NextResponse.json({ entries });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load course languages" }, { status: 500 });
  }
}

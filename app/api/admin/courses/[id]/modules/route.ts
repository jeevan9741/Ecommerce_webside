import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { moduleSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: courseId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = moduleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const last = await prisma.module.findFirst({ where: { courseId }, orderBy: { displayOrder: "desc" } });
    const module_ = await prisma.module.create({
      data: {
        courseId,
        title: parsed.data.title,
        displayOrder: parsed.data.displayOrder ?? (last ? last.displayOrder + 1 : 0),
      },
      include: { lessons: true },
    });
    return NextResponse.json({ module: module_ });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Failed to create module:", err);
    return NextResponse.json({ error: "Failed to create module" }, { status: 500 });
  }
}

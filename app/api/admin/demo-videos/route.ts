import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { deleteObject } from "@/lib/storage";

const bodySchema = z.object({
  languageId: z.string().min(1),
  storageKey: z.string().min(1),
});

export async function GET() {
  try {
    await requireAdmin();
    const videos = await prisma.demoVideo.findMany({
      include: { language: true },
      orderBy: { language: { displayOrder: "asc" } },
    });
    return NextResponse.json({ videos });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load demo videos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const existing = await prisma.demoVideo.findUnique({ where: { languageId: parsed.data.languageId } });

    const video = await prisma.demoVideo.upsert({
      where: { languageId: parsed.data.languageId },
      update: { storageKey: parsed.data.storageKey },
      create: parsed.data,
      include: { language: true },
    });

    if (existing && existing.storageKey !== parsed.data.storageKey) {
      await deleteObject(existing.storageKey).catch((err) => console.error("Failed to delete old demo video blob:", err));
    }

    return NextResponse.json({ video });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to save demo video" }, { status: 500 });
  }
}

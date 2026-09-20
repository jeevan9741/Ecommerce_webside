import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { languageSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireAdmin();
    const languages = await prisma.language.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { courseVideos: true } } },
    });
    return NextResponse.json({ languages });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load languages" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = languageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const existing = await prisma.language.findUnique({ where: { code: parsed.data.code } });
    if (existing) {
      return NextResponse.json({ error: "A language with this code already exists." }, { status: 409 });
    }
    const language = await prisma.language.create({ data: parsed.data });
    return NextResponse.json({ language });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to create language" }, { status: 500 });
  }
}

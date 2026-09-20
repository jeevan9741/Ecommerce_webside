import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";

const bodySchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1),
  displayOrder: z.number().int().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const certificates = await prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } });
    return NextResponse.json({ certificates });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load certificates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const certificate = await prisma.certificate.create({ data: parsed.data });
    return NextResponse.json({ certificate });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to create certificate" }, { status: 500 });
  }
}

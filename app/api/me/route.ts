import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
  preferredLanguageCode: z.string().max(10).optional().nullable(),
});

export async function GET() {
  try {
    const sessionUser = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        username: true,
        referralCode: true,
        role: true,
        createdAt: true,
        preferredLanguage: { select: { code: true, name: true, nativeName: true } },
        courseAccess: {
          where: { revokedAt: null },
          select: {
            unlockedAt: true,
            languageGranted: true,
            course: { select: { id: true, title: true, type: true, slug: true } },
          },
        },
      },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sessionUser = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { preferredLanguageCode, ...rest } = parsed.data;

    let preferredLanguageId: string | null | undefined = undefined;
    if (preferredLanguageCode !== undefined) {
      if (preferredLanguageCode === null) {
        preferredLanguageId = null;
      } else {
        const language = await prisma.language.findUnique({ where: { code: preferredLanguageCode } });
        if (!language) return NextResponse.json({ error: "Unknown language" }, { status: 400 });
        preferredLanguageId = language.id;
      }
    }

    const user = await prisma.user.update({
      where: { id: sessionUser.id },
      data: { ...rest, ...(preferredLanguageId !== undefined ? { preferredLanguageId } : {}) },
      select: {
        name: true,
        phone: true,
        preferredLanguage: { select: { code: true, name: true, nativeName: true } },
      },
    });
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}

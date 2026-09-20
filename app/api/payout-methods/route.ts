import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { payoutMethodSchema } from "@/lib/validation";
import { encryptJson } from "@/lib/crypto";

export async function GET() {
  try {
    const user = await requireUser();
    const methods = await prisma.payoutMethod.findMany({
      where: { userId: user.id },
      select: { id: true, type: true, label: true, isDefault: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ methods });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to load payout methods" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const parsed = payoutMethodSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payout details" }, { status: 400 });
    }
    const { type, label, ...details } = parsed.data;

    const method = await prisma.payoutMethod.create({
      data: {
        userId: user.id,
        type,
        label,
        encryptedDetails: encryptJson(details),
      },
      select: { id: true, type: true, label: true, createdAt: true },
    });

    return NextResponse.json({ method });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Failed to save payout method" }, { status: 500 });
  }
}

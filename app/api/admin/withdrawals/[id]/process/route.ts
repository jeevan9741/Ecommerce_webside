import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { attemptAutomatedPayout } from "@/lib/payouts";

const bodySchema = z.object({
  action: z.enum(["SUCCESS", "FAILED", "PROCESSING"]),
  providerRefId: z.string().optional(),
  failureReason: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!withdrawal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.action === "PROCESSING") {
      await attemptAutomatedPayout(id);
    }

    const updated = await prisma.withdrawalRequest.update({
      where: { id },
      data: {
        status: parsed.data.action,
        providerRefId: parsed.data.providerRefId,
        failureReason: parsed.data.failureReason,
        processedAt: parsed.data.action === "SUCCESS" || parsed.data.action === "FAILED" ? new Date() : undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: `WITHDRAWAL_${parsed.data.action}`,
        target: id,
      },
    });

    return NextResponse.json({ withdrawal: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to process withdrawal" }, { status: 500 });
  }
}

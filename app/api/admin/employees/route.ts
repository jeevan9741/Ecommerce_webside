import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { employeeSchema } from "@/lib/validation";

export async function GET() {
  try {
    await requireAdmin();
    const employees = await prisma.employee.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ employees });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load employees" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const parsed = employeeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const employee = await prisma.employee.create({
      data: { ...parsed.data, joiningDate: new Date(parsed.data.joiningDate) },
    });
    return NextResponse.json({ employee });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}

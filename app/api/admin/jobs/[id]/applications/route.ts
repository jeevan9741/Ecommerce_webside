import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/rbac";
import { getDownloadUrl } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: jobId } = await params;
    const applications = await prisma.jobApplication.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
    const withUrls = await Promise.all(
      applications.map(async (a) => ({
        ...a,
        resumeUrl: a.resumeStorageKey ? await getDownloadUrl(a.resumeStorageKey, 300) : null,
      }))
    );
    return NextResponse.json({ applications: withUrls });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Failed to load applications" }, { status: 500 });
  }
}

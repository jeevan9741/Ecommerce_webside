import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const jobs = await prisma.jobPosting.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      eligibility: true,
      salary: true,
      workType: true,
      workingHours: true,
    },
  });
  return NextResponse.json({ jobs });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public course catalogue — price and content only. Commission amounts and any
// partner/referral data must never appear in a response reachable without auth.
export async function GET() {
  const courses = await prisma.course.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      type: true,
      title: true,
      shortDescription: true,
      description: true,
      priceInPaise: true,
      metadata: true,
      languageVideos: {
        select: { language: { select: { code: true, name: true, nativeName: true } } },
      },
    },
  });

  const mapped = courses.map(({ languageVideos, ...course }) => ({
    ...course,
    languages: languageVideos.map((lv) => lv.language),
  }));

  return NextResponse.json({ courses: mapped });
}

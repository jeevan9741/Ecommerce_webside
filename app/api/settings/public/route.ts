import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PUBLIC_KEYS = ["about", "contact", "socialLinks", "founder", "legal"];

export async function GET() {
  const settings = await prisma.siteSetting.findMany({
    where: { key: { in: PUBLIC_KEYS } },
  });
  const map: Record<string, unknown> = {};
  for (const s of settings) map[s.key] = s.value;
  return NextResponse.json({ settings: map });
}

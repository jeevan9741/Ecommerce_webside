import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/storage";

export async function GET() {
  const certificates = await prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } });
  const withUrls = await Promise.all(
    certificates.map(async (c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      url: await getDownloadUrl(c.storageKey, 600),
    }))
  );
  return NextResponse.json({ certificates: withUrls });
}

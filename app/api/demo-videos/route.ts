import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang");

  if (lang) {
    const video = await prisma.demoVideo.findFirst({
      where: { language: { code: lang, isActive: true } },
      include: { language: true },
    });
    if (!video) return NextResponse.json({ error: "No demo video for this language" }, { status: 404 });
    return NextResponse.json({
      video: {
        languageCode: video.language.code,
        languageName: video.language.name,
        url: await getDownloadUrl(video.storageKey, 600),
      },
    });
  }

  const videos = await prisma.demoVideo.findMany({
    where: { language: { isActive: true } },
    include: { language: true },
    orderBy: { language: { displayOrder: "asc" } },
  });
  return NextResponse.json({
    languages: videos.map((v) => ({
      languageCode: v.language.code,
      languageName: v.language.name,
      nativeName: v.language.nativeName,
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, UnauthorizedError } from "@/lib/rbac";
import { getDownloadUrl } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: courseId } = await params;

    const access = await prisma.courseAccess.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });
    if (!access || access.revokedAt) {
      return NextResponse.json({ error: "You do not have access to this course" }, { status: 403 });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        languageVideos: { include: { language: true } },
        modules: { orderBy: { displayOrder: "asc" }, include: { lessons: { orderBy: { displayOrder: "asc" } } } },
      },
    });
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const languages = await Promise.all(
      course.languageVideos.map(async (lv) => ({
        code: lv.language.code,
        name: lv.language.name,
        nativeName: lv.language.nativeName,
        videoUrl: lv.videoUrl ? await getDownloadUrl(lv.videoUrl, 900) : null,
        subtitleUrl: lv.subtitleUrl ? await getDownloadUrl(lv.subtitleUrl, 900) : null,
        ebookUrl: lv.ebookUrl ? await getDownloadUrl(lv.ebookUrl, 900) : null,
      }))
    );

    const modules = await Promise.all(
      course.modules.map(async (m) => ({
        id: m.id,
        title: m.title,
        lessons: await Promise.all(
          m.lessons.map(async (l) => ({
            id: l.id,
            title: l.title,
            videoUrl: l.videoUrl ? await getDownloadUrl(l.videoUrl, 900) : null,
            subtitleUrl: l.subtitleUrl ? await getDownloadUrl(l.subtitleUrl, 900) : null,
          }))
        ),
      }))
    );

    return NextResponse.json({
      course: { id: course.id, title: course.title, type: course.type, metadata: course.metadata },
      defaultLanguageCode: access.languageGranted,
      languages,
      modules,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Failed to load course content" }, { status: 500 });
  }
}

import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import {
  courseSchema,
  courseLanguageVideoSchema,
  languageSchema,
  lessonSchema,
  moduleSchema,
} from "../utils/validation.js";
import { buildStorageKey, deleteObject, getDownloadUrl, getUploadUrl } from "../services/storage.service.js";
import { HttpError, param } from "../utils/http.js";

function cleanupBlob(key: string, label: string) {
  return deleteObject(key).catch((err) => console.error(`Failed to delete ${label} blob:`, err));
}

// ---------- Courses ----------

export async function listCourses(_req: Request, res: Response) {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      languageVideos: { include: { language: true } },
      modules: { orderBy: { displayOrder: "asc" }, include: { lessons: { orderBy: { displayOrder: "asc" } } } },
      _count: { select: { orders: true, access: true } },
    },
  });
  res.json({ courses });
}

export async function createCourse(req: Request, res: Response) {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const course = await prisma.course.create({ data: parsed.data });
  res.json({ course });
}

export async function updateCourse(req: Request, res: Response) {
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const course = await prisma.course.update({ where: { id: param(req, "id") }, data: parsed.data });
  res.json({ course });
}

/** Soft delete — keeps order history and access records intact. */
export async function deactivateCourse(req: Request, res: Response) {
  await prisma.course.update({ where: { id: param(req, "id") }, data: { isActive: false } });
  res.json({ ok: true });
}

// ---------- Per-language course content ----------

const LANGUAGE_CONTENT_FIELDS = ["videoUrl", "subtitleUrl", "ebookUrl"] as const;

export async function listCourseLanguages(req: Request, res: Response) {
  const entries = await prisma.courseLanguageVideo.findMany({
    where: { courseId: param(req, "id") },
    include: { language: true },
    orderBy: { language: { displayOrder: "asc" } },
  });
  res.json({ entries });
}

export async function upsertCourseLanguage(req: Request, res: Response) {
  const courseId = param(req, "id");
  const languageId = param(req, "languageId");
  const parsed = courseLanguageVideoSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");

  const existing = await prisma.courseLanguageVideo.findUnique({
    where: { courseId_languageId: { courseId, languageId } },
  });

  const entry = await prisma.courseLanguageVideo.upsert({
    where: { courseId_languageId: { courseId, languageId } },
    update: parsed.data,
    create: { courseId, languageId, ...parsed.data },
    include: { language: true },
  });

  // Replacing or clearing a field orphans its old blob — clean up now that the DB write succeeded.
  if (existing) {
    for (const field of LANGUAGE_CONTENT_FIELDS) {
      const oldKey = existing[field];
      if (oldKey && field in parsed.data && oldKey !== parsed.data[field]) await cleanupBlob(oldKey, `old ${field}`);
    }
  }
  res.json({ entry });
}

export async function removeCourseLanguage(req: Request, res: Response) {
  const existing = await prisma.courseLanguageVideo.delete({
    where: { courseId_languageId: { courseId: param(req, "id"), languageId: param(req, "languageId") } },
  });
  for (const field of LANGUAGE_CONTENT_FIELDS) {
    const key = existing[field];
    if (key) await cleanupBlob(key, field);
  }
  res.json({ ok: true });
}

// ---------- Curriculum: modules & lessons ----------

export async function createModule(req: Request, res: Response) {
  const courseId = param(req, "id");
  const parsed = moduleSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");

  const last = await prisma.module.findFirst({ where: { courseId }, orderBy: { displayOrder: "desc" } });
  const module_ = await prisma.module.create({
    data: {
      courseId,
      title: parsed.data.title,
      displayOrder: parsed.data.displayOrder ?? (last ? last.displayOrder + 1 : 0),
    },
    include: { lessons: true },
  });
  res.json({ module: module_ });
}

export async function updateModule(req: Request, res: Response) {
  const parsed = moduleSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const module_ = await prisma.module.update({
    where: { id: param(req, "id") },
    data: parsed.data,
    include: { lessons: true },
  });
  res.json({ module: module_ });
}

export async function deleteModule(req: Request, res: Response) {
  const id = param(req, "id");
  // Clean up every lesson's blobs before the cascade delete removes the rows.
  const lessons = await prisma.lesson.findMany({ where: { moduleId: id } });
  for (const lesson of lessons) {
    if (lesson.videoUrl) await cleanupBlob(lesson.videoUrl, "lesson video");
    if (lesson.subtitleUrl) await cleanupBlob(lesson.subtitleUrl, "lesson subtitle");
  }
  await prisma.module.delete({ where: { id } });
  res.json({ ok: true });
}

export async function createLesson(req: Request, res: Response) {
  const moduleId = param(req, "id");
  const parsed = lessonSchema.pick({ title: true, displayOrder: true }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");

  const last = await prisma.lesson.findFirst({ where: { moduleId }, orderBy: { displayOrder: "desc" } });
  const lesson = await prisma.lesson.create({
    data: {
      moduleId,
      title: parsed.data.title,
      displayOrder: parsed.data.displayOrder ?? (last ? last.displayOrder + 1 : 0),
    },
  });
  res.json({ lesson });
}

const LESSON_FIELDS = ["videoUrl", "subtitleUrl"] as const;

export async function updateLesson(req: Request, res: Response) {
  const id = param(req, "id");
  const parsed = lessonSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");

  const existing = await prisma.lesson.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Lesson not found");

  const lesson = await prisma.lesson.update({ where: { id }, data: parsed.data });

  for (const field of LESSON_FIELDS) {
    const oldKey = existing[field];
    if (oldKey && field in parsed.data && oldKey !== parsed.data[field]) await cleanupBlob(oldKey, `old lesson ${field}`);
  }
  res.json({ lesson });
}

export async function deleteLesson(req: Request, res: Response) {
  const lesson = await prisma.lesson.delete({ where: { id: param(req, "id") } });
  for (const field of LESSON_FIELDS) {
    const key = lesson[field];
    if (key) await cleanupBlob(key, `lesson ${field}`);
  }
  res.json({ ok: true });
}

export async function previewLesson(req: Request, res: Response) {
  const lesson = await prisma.lesson.findUnique({ where: { id: param(req, "id") } });
  if (!lesson) throw new HttpError(404, "Lesson not found");
  if (!lesson.videoUrl) throw new HttpError(404, "No video uploaded for this lesson");
  res.json({
    videoUrl: await getDownloadUrl(lesson.videoUrl, 600),
    subtitleUrl: lesson.subtitleUrl ? await getDownloadUrl(lesson.subtitleUrl, 600) : null,
  });
}

// ---------- Languages ----------

export async function listLanguages(_req: Request, res: Response) {
  const languages = await prisma.language.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { courseVideos: true } } },
  });
  res.json({ languages });
}

export async function createLanguage(req: Request, res: Response) {
  const parsed = languageSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const existing = await prisma.language.findUnique({ where: { code: parsed.data.code } });
  if (existing) throw new HttpError(409, "A language with this code already exists.");
  const language = await prisma.language.create({ data: parsed.data });
  res.json({ language });
}

export async function updateLanguage(req: Request, res: Response) {
  const parsed = languageSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const language = await prisma.language.update({ where: { id: param(req, "id") }, data: parsed.data });
  res.json({ language });
}

// ---------- Uploads ----------

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  prefix: z.enum(["course-content", "demo-videos", "certificates"]),
});

/** Issues a short-lived signed PUT URL so the browser uploads straight to Blob storage. */
export async function presignUpload(req: Request, res: Response) {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const key = buildStorageKey(parsed.data.prefix, parsed.data.filename);
  const uploadUrl = await getUploadUrl(key, parsed.data.contentType);
  res.json({ uploadUrl, key });
}

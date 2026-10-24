import { randomInt } from "node:crypto";
import type { CourseType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/http.js";
import { ownsPaidPackage } from "./package-access.service.js";

/**
 * Course completion certificates (see CourseCertificate in the schema).
 *
 * - A course is a purchased package. Its lessons are the published videos it gives access to:
 *   its own videos plus the videos in the live library categories it unlocks.
 * - Completing one language version is enough: videos without a language belong to every track,
 *   and a track is those plus the videos in one language.
 * - VIDEO packages issue automatically at 100%; Zoom, offline centre and e-book packages are
 *   issued by an admin.
 */

export const SIGNATORY_SETTING_KEY = "certificateSignatory";

export interface Signatory {
  name: string;
  title: string;
  /** Private Blob key of the signature image; null prints a blank signature line. */
  signatureKey: string | null;
}

const DEFAULT_SIGNATORY: Signatory = { name: "Umesh Chauhan", title: "Founder & CEO", signatureKey: null };

export async function getSignatory(): Promise<Signatory> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SIGNATORY_SETTING_KEY } });
  const value = (row?.value ?? {}) as Partial<Signatory>;
  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name : DEFAULT_SIGNATORY.name,
    title: typeof value.title === "string" && value.title.trim() ? value.title : DEFAULT_SIGNATORY.title,
    signatureKey: typeof value.signatureKey === "string" ? value.signatureKey : null,
  };
}

// ---------- Certificate IDs ----------

/** No 0/O, 1/I/L: IDs get read aloud and typed in by hand. */
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** ECA-YYYY-XXXXXX, random so IDs can't be enumerated. */
export function generateCertificateNo(date = new Date()) {
  let code = "";
  for (let i = 0; i < 6; i++) code += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `ECA-${date.getUTCFullYear()}-${code}`;
}

export function normaliseCertificateNo(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

// ---------- Progress ----------

export type IssueMode = "auto" | "admin";

/** VIDEO packages earn certificates automatically; the others are issued by an admin. */
export function issueMode(type: CourseType): IssueMode {
  return type === "VIDEO" ? "auto" : "admin";
}

interface Lesson {
  id: string;
  language: { id: string; code: string; name: string } | null;
}

/** Published lessons a package gives access to: its own videos and those in the live categories it unlocks. */
async function courseLessons(courseId: string): Promise<Lesson[]> {
  const links = await prisma.categoryPackage.findMany({
    where: { courseId, category: { parentId: null, isActive: true } },
    select: { categoryId: true },
  });
  const topIds = links.map((l) => l.categoryId);
  return prisma.courseVideo.findMany({
    where: {
      isPublished: true,
      OR: [
        { courseId },
        ...(topIds.length ? [{ category: { isActive: true, OR: [{ id: { in: topIds } }, { parentId: { in: topIds } }] } }] : []),
      ],
    },
    select: { id: true, language: { select: { id: true, code: true, name: true } } },
  });
}

export interface CourseProgress {
  totalLessons: number;
  completedLessons: number;
  /** Rounded down, so it only reads 100 when every lesson is done. */
  percent: number;
  /** The language track this progress is for; null when the course has no per-language videos. */
  language: { code: string; name: string } | null;
  isComplete: boolean;
  /** When the last lesson of the completed track was finished. */
  completedAt: Date | null;
}

/**
 * The student's progress on their best language track: a finished track if there is one,
 * otherwise the furthest along (ties go to their preferred language).
 */
export async function courseProgress(userId: string, courseId: string): Promise<CourseProgress> {
  const [lessons, user] = await Promise.all([
    courseLessons(courseId),
    prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguageId: true } }),
  ]);
  const done = new Map(
    (
      await prisma.videoProgress.findMany({
        where: { userId, completed: true, videoId: { in: lessons.map((l) => l.id) } },
        select: { videoId: true, completedAt: true, updatedAt: true },
      })
    ).map((p) => [p.videoId, p.completedAt ?? p.updatedAt])
  );

  const neutral = lessons.filter((l) => !l.language);
  const languages = [...new Map(lessons.filter((l) => l.language).map((l) => [l.language!.id, l.language!])).values()];
  const tracks = (languages.length ? languages : [null]).map((language) => {
    const own = language ? [...neutral, ...lessons.filter((l) => l.language?.id === language.id)] : neutral;
    const finished = own.filter((l) => done.has(l.id));
    return {
      language,
      total: own.length,
      completed: finished.length,
      isComplete: own.length > 0 && finished.length === own.length,
      completedAt: finished.reduce<Date | null>((latest, l) => {
        const at = done.get(l.id)!;
        return !latest || at > latest ? at : latest;
      }, null),
    };
  });

  const share = (t: (typeof tracks)[number]) => (t.total ? t.completed / t.total : 0);
  const best = tracks.reduce((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? a : b;
    if (share(a) !== share(b)) return share(a) > share(b) ? a : b;
    return b.language?.id === user?.preferredLanguageId ? b : a;
  });

  return {
    totalLessons: best.total,
    completedLessons: best.completed,
    percent: best.total ? Math.floor((best.completed / best.total) * 100) : 0,
    language: best.language ? { code: best.language.code, name: best.language.name } : null,
    isComplete: best.isComplete,
    completedAt: best.isComplete ? best.completedAt : null,
  };
}

// ---------- Issuing ----------

async function createCertificate(data: {
  userId: string;
  courseId: string;
  studentName: string;
  courseTitle: string;
  completedAt: Date;
  lessonCount: number;
  issuedById: string | null;
}) {
  // Retry on the (very unlikely) certificate ID collision; a second certificate for the same
  // student and course (e.g. a double click) returns the first one instead.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.courseCertificate.create({ data: { ...data, certificateNo: generateCertificateNo() } });
    } catch (err) {
      const e = err as { code?: string; meta?: { target?: unknown } };
      if (e.code !== "P2002") throw err;
      if (String(e.meta?.target ?? "").includes("certificateNo")) continue;
      const existing = await prisma.courseCertificate.findUnique({ where: { userId_courseId: { userId: data.userId, courseId: data.courseId } } });
      if (existing) return existing;
      continue;
    }
  }
  throw new HttpError(500, "Could not create the certificate. Please try again.");
}

/** Paid, live access to the package (see package-access.service). */
async function ownsCourse(userId: string, courseId: string) {
  return ownsPaidPackage(userId, courseId);
}

/** The student claims the certificate for a VIDEO package they've completed. Idempotent. */
export async function issueOnCompletion(userId: string, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, type: true } });
  if (!course) throw new HttpError(404, "Course not found");
  if (!(await ownsCourse(userId, courseId))) throw new HttpError(403, "You don't have access to this course.");

  const existing = await prisma.courseCertificate.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (existing) return existing;
  if (issueMode(course.type) !== "auto") {
    throw new HttpError(400, "Certificates for this course are issued by the academy once you complete the training.");
  }

  const progress = await courseProgress(userId, courseId);
  if (!progress.isComplete) {
    throw new HttpError(400, `Complete all lessons to get your certificate (${progress.completedLessons} of ${progress.totalLessons} done).`, {
      code: "COURSE_INCOMPLETE",
      progress,
    });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new HttpError(404, "Not found");

  return createCertificate({
    userId,
    courseId,
    studentName: user.name.trim(),
    courseTitle: course.title,
    completedAt: progress.completedAt ?? new Date(),
    lessonCount: progress.totalLessons,
    issuedById: null,
  });
}

/** An admin issues the certificate for a Zoom, offline centre or e-book package. */
export async function issueByAdmin(adminId: string, input: { userId: string; courseId: string; completedAt: Date }) {
  const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true, title: true, type: true } });
  if (!course) throw new HttpError(404, "Course not found");
  if (issueMode(course.type) === "auto") {
    throw new HttpError(400, "Video course certificates are issued automatically when the student completes every lesson.");
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true } });
  if (!user) throw new HttpError(404, "Student not found");
  if (!(await ownsCourse(input.userId, course.id))) throw new HttpError(400, "This student hasn't purchased this course.");
  if (await prisma.courseCertificate.count({ where: { userId: input.userId, courseId: course.id } })) {
    throw new HttpError(409, "This student already has a certificate for this course.");
  }

  return createCertificate({
    userId: input.userId,
    courseId: course.id,
    studentName: user.name.trim(),
    courseTitle: course.title,
    completedAt: input.completedAt,
    lessonCount: 0,
    issuedById: adminId,
  });
}

export function certificateStatus(c: { revokedAt: Date | null }) {
  return c.revokedAt ? "REVOKED" : "VALID";
}

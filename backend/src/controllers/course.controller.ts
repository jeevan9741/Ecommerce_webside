import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { getDownloadUrl, uploadBuffer, buildStorageKey } from "../services/storage.service.js";
import { jobApplicationSchema } from "../utils/validation.js";
import { rateLimit } from "../utils/rate-limit.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";

/**
 * Public course catalogue — price and content only. Commission amounts and any
 * partner/referral data must never appear here. When the caller is signed in, the
 * response also lists which courses they already own (used by the Buy button).
 */
export async function listCourses(req: Request, res: Response) {
  const [courses, access] = await Promise.all([
    prisma.course.findMany({
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
        languageVideos: { select: { language: { select: { code: true, name: true, nativeName: true } } } },
      },
    }),
    req.user
      ? prisma.courseAccess.findMany({ where: { userId: req.user.id, revokedAt: null }, select: { courseId: true } })
      : Promise.resolve([]),
  ]);

  res.json({
    courses: courses.map(({ languageVideos, ...course }) => ({
      ...course,
      languages: languageVideos.map((lv) => lv.language),
    })),
    ownedCourseIds: access.map((a) => a.courseId),
  });
}

export async function courseContent(req: Request, res: Response) {
  const user = currentUser(req);
  const courseId = param(req, "id");

  const access = await prisma.courseAccess.findUnique({
    where: { userId_courseId: { userId: user.id, courseId } },
  });
  if (!access || access.revokedAt) throw new HttpError(403, "You do not have access to this course");

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      languageVideos: { include: { language: true } },
      modules: { orderBy: { displayOrder: "asc" }, include: { lessons: { orderBy: { displayOrder: "asc" } } } },
    },
  });
  if (!course) throw new HttpError(404, "Course not found");

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

  res.json({
    course: { id: course.id, title: course.title, type: course.type, metadata: course.metadata },
    defaultLanguageCode: access.languageGranted,
    languages,
    modules,
  });
}

export async function listLanguages(_req: Request, res: Response) {
  const languages = await prisma.language.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, nativeName: true },
  });
  res.json({ languages });
}

export async function demoVideos(req: Request, res: Response) {
  const lang = typeof req.query.lang === "string" ? req.query.lang : null;

  if (lang) {
    const video = await prisma.demoVideo.findFirst({
      where: { language: { code: lang, isActive: true } },
      include: { language: true },
    });
    // A language without a demo yet is a normal state, not an error — the page shows a placeholder.
    if (!video) return res.json({ video: null });
    return res.json({
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
  res.json({
    languages: videos.map((v) => ({
      languageCode: v.language.code,
      languageName: v.language.name,
      nativeName: v.language.nativeName,
    })),
  });
}

export async function listReviews(_req: Request, res: Response) {
  const reviews = await prisma.review.findMany({
    where: { isApproved: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, customerName: true, rating: true, text: true },
  });
  res.json({ reviews });
}

const PUBLIC_SETTING_KEYS = ["about", "contact", "socialLinks", "founder", "legal"];

export async function publicSettings(_req: Request, res: Response) {
  const settings = await prisma.siteSetting.findMany({ where: { key: { in: PUBLIC_SETTING_KEYS } } });
  const map: Record<string, unknown> = {};
  for (const s of settings) map[s.key] = s.value;
  res.json({ settings: map });
}

export async function listCertificates(_req: Request, res: Response) {
  const certificates = await prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } });
  const withUrls = await Promise.all(
    certificates.map(async (c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      url: await getDownloadUrl(c.storageKey, 600),
    }))
  );
  res.json({ certificates: withUrls });
}

export async function listJobs(_req: Request, res: Response) {
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
      createdAt: true,
    },
  });
  res.json({ jobs });
}

export async function getJob(req: Request, res: Response) {
  const job = await prisma.jobPosting.findUnique({ where: { id: param(req, "id") } });
  if (!job || !job.isActive) throw new HttpError(404, "Job not found");
  res.json({ job });
}

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function applyToJob(req: Request, res: Response) {
  const jobId = param(req, "id");

  if (!rateLimit(`job-apply:${req.ip ?? "unknown"}`, 10, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many applications submitted. Please try again later.");
  }

  const job = await prisma.jobPosting.findUnique({ where: { id: jobId } });
  if (!job || !job.isActive) throw new HttpError(404, "This position is no longer accepting applications");

  const parsed = jobApplicationSchema.safeParse({
    jobId,
    applicantName: req.body?.applicantName,
    email: req.body?.email,
    phone: req.body?.phone,
    coverNote: req.body?.coverNote || undefined,
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");

  let resumeStorageKey: string | undefined;
  const resume = req.file;
  if (resume && resume.size > 0) {
    if (resume.size > MAX_RESUME_BYTES) throw new HttpError(400, "Resume must be under 5MB");
    if (!ALLOWED_RESUME_TYPES.includes(resume.mimetype)) throw new HttpError(400, "Resume must be a PDF or Word document");
    resumeStorageKey = buildStorageKey("resumes", resume.originalname);
    await uploadBuffer(resumeStorageKey, resume.buffer, resume.mimetype);
  }

  const application = await prisma.jobApplication.create({
    data: {
      jobId,
      applicantName: parsed.data.applicantName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      coverNote: parsed.data.coverNote,
      resumeStorageKey,
    },
  });
  res.json({ ok: true, applicationId: application.id });
}

/** About page: certificates (with signed URLs) plus the editable settings blocks. */
export async function aboutPage(_req: Request, res: Response) {
  const [certificates, settings] = await Promise.all([
    prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.siteSetting.findMany({ where: { key: { in: ["about", "founder", "contact", "legal"] } } }),
  ]);
  const map: Record<string, unknown> = {};
  for (const s of settings) map[s.key] = s.value;
  res.json({
    settings: map,
    certificates: await Promise.all(
      certificates.map(async (c) => {
        // One unsignable file shouldn't take the whole About page down — show it as unavailable.
        let url: string | null = null;
        try {
          url = await getDownloadUrl(c.storageKey, 600);
        } catch {
          url = null;
        }
        return { id: c.id, title: c.title, description: c.description, url };
      })
    ),
  });
}

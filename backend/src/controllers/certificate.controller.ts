import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { CourseCertificate, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { PAID_ACCESS } from "../services/package-access.service.js";
import { deleteObject, getDownloadUrl, uploadBuffer } from "../services/storage.service.js";
import {
  SIGNATORY_SETTING_KEY,
  certificateStatus,
  courseProgress,
  getSignatory,
  issueByAdmin,
  issueMode,
  issueOnCompletion,
  normaliseCertificateNo,
} from "../services/certificate.service.js";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

async function audit(actorId: string | null, action: string, target: string, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { actorId, action, target, metadata } });
}

/** What the certificate shows, plus its status. Same shape for the owner, the admin and the public page. */
function certificateView(c: CourseCertificate) {
  return {
    id: c.id,
    certificateNo: c.certificateNo,
    studentName: c.studentName,
    courseTitle: c.courseTitle,
    courseId: c.courseId,
    completedAt: c.completedAt,
    issuedAt: c.issuedAt,
    status: certificateStatus(c),
  };
}

const SIGNATURE_URL_TTL = 10 * 60;

/** Signatory for rendering: the signature image as a short-lived signed link (it lives in the private store). */
async function signatoryView() {
  const s = await getSignatory();
  return {
    name: s.name,
    title: s.title,
    signatureUrl: s.signatureKey ? await getDownloadUrl(s.signatureKey, SIGNATURE_URL_TTL).catch(() => null) : null,
  };
}

// ---------- Students ----------

/** My certificates, and each owned course's progress towards one. */
export async function myCertificates(req: Request, res: Response) {
  const user = currentUser(req);
  const [certificates, access] = await Promise.all([
    prisma.courseCertificate.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" } }),
    prisma.courseAccess.findMany({
      where: { userId: user.id, ...PAID_ACCESS },
      include: { course: { select: { id: true, title: true, type: true } } },
      orderBy: { unlockedAt: "desc" },
    }),
  ]);
  const byCourse = new Map(certificates.map((c) => [c.courseId, c]));
  const courses = await Promise.all(
    access.map(async ({ course }) => ({
      courseId: course.id,
      title: course.title,
      type: course.type,
      mode: issueMode(course.type),
      certificateNo: byCourse.get(course.id)?.certificateNo ?? null,
      progress: issueMode(course.type) === "auto" ? await courseProgress(user.id, course.id) : null,
    }))
  );
  res.json({ certificates: certificates.map(certificateView), courses });
}

/** Progress and certificate for one owned course (the course page's certificate panel). */
export async function myCourseCertificate(req: Request, res: Response) {
  const user = currentUser(req);
  const courseId = param(req, "courseId");
  const access = await prisma.courseAccess.findFirst({
    where: { userId: user.id, courseId, ...PAID_ACCESS },
    include: { course: { select: { type: true } } },
  });
  if (!access) throw new HttpError(404, "Not found");
  const [certificate, progress] = await Promise.all([
    prisma.courseCertificate.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } }),
    issueMode(access.course.type) === "auto" ? courseProgress(user.id, courseId) : null,
  ]);
  res.json({ mode: issueMode(access.course.type), progress, certificate: certificate ? certificateView(certificate) : null });
}

/** Issues the certificate once every lesson is complete (checked here, not trusted from the page). */
export async function claimCertificate(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`certificate-claim:${user.id}`, 20, 60 * 1000)) throw new HttpError(429, "Too many requests");
  const before = await prisma.courseCertificate.count({ where: { userId: user.id, courseId: param(req, "courseId") } });
  const certificate = await issueOnCompletion(user.id, param(req, "courseId"));
  if (!before) await audit(user.id, "CERTIFICATE_ISSUED", certificate.id, { certificateNo: certificate.certificateNo, auto: true });
  res.status(before ? 200 : 201).json({ certificate: certificateView(certificate) });
}

/** One certificate with everything needed to render it. Its owner or an admin only. */
export async function getCertificate(req: Request, res: Response) {
  const user = currentUser(req);
  const certificate = await prisma.courseCertificate.findUnique({ where: { certificateNo: normaliseCertificateNo(param(req, "certificateNo")) } });
  if (!certificate || (certificate.userId !== user.id && user.role !== "ADMIN")) throw new HttpError(404, "Certificate not found");
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ certificate: certificateView(certificate), signatory: await signatoryView() });
}

// ---------- Public verification (QR code) ----------

export async function verifyCertificate(req: Request, res: Response) {
  if (!rateLimit(`certificate-verify:${req.ip}`, 120, 60 * 1000)) throw new HttpError(429, "Too many lookups. Please wait a minute.");
  const certificate = await prisma.courseCertificate.findUnique({ where: { certificateNo: normaliseCertificateNo(param(req, "certificateNo")) } });
  if (!certificate) throw new HttpError(404, "Certificate not found");
  const { id: _id, courseId: _courseId, ...view } = certificateView(certificate);
  res.json({ certificate: view });
}

// ---------- Admin ----------

export async function adminListCertificates(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where: Prisma.CourseCertificateWhereInput = q
    ? {
        OR: [
          { certificateNo: { contains: normaliseCertificateNo(q) } },
          { studentName: { contains: q, mode: "insensitive" } },
          { courseTitle: { contains: q, mode: "insensitive" } },
          { user: { email: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {};
  const certificates = await prisma.courseCertificate.findMany({
    where,
    include: { user: { select: { email: true } } },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  res.json({
    certificates: certificates.map((c) => ({ ...certificateView(c), email: c.user.email, issuedBy: c.issuedById ? "admin" : "auto", revokedAt: c.revokedAt, revokedReason: c.revokedReason })),
  });
}

/** Verify by ID: the certificate, who holds it, and (video courses) whether the progress still backs it. */
export async function adminGetCertificate(req: Request, res: Response) {
  const certificate = await prisma.courseCertificate.findUnique({
    where: { certificateNo: normaliseCertificateNo(param(req, "certificateNo")) },
    include: { user: { select: { id: true, email: true, phone: true, name: true } }, course: { select: { type: true } } },
  });
  if (!certificate) throw new HttpError(404, "No certificate with this ID");
  res.json({
    certificate: {
      ...certificateView(certificate),
      courseType: certificate.course.type,
      lessonCount: certificate.lessonCount,
      issuedBy: certificate.issuedById ? "admin" : "auto",
      revokedAt: certificate.revokedAt,
      revokedReason: certificate.revokedReason,
      student: certificate.user,
      currentProgress: issueMode(certificate.course.type) === "auto" ? await courseProgress(certificate.userId, certificate.courseId) : null,
    },
  });
}

const issueSchema = z.object({
  email: z.string().trim().email("Enter the student's email"),
  courseId: z.string().min(1, "Choose a course"),
  completedAt: z.coerce.date().optional(),
});

export async function adminIssueCertificate(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(issueSchema, req.body);
  const student = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() }, select: { id: true } });
  if (!student) throw new HttpError(404, "No student account with this email");
  if (body.completedAt && body.completedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new HttpError(400, "Completion date can't be in the future");
  const certificate = await issueByAdmin(admin.id, { userId: student.id, courseId: body.courseId, completedAt: body.completedAt ?? new Date() });
  await audit(admin.id, "CERTIFICATE_ISSUED", certificate.id, { certificateNo: certificate.certificateNo, auto: false });
  res.status(201).json({ certificate: certificateView(certificate) });
}

const revokeSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(300) });

export async function adminRevokeCertificate(req: Request, res: Response) {
  const admin = currentUser(req);
  const { reason } = parse(revokeSchema, req.body);
  const certificate = await prisma.courseCertificate
    .update({ where: { id: param(req, "id") }, data: { revokedAt: new Date(), revokedReason: reason } })
    .catch((err: { code?: string }) => {
      if (err.code === "P2025") throw new HttpError(404, "Certificate not found");
      throw err;
    });
  await audit(admin.id, "CERTIFICATE_REVOKED", certificate.id, { certificateNo: certificate.certificateNo, reason });
  res.json({ certificate: certificateView(certificate) });
}

export async function adminRestoreCertificate(req: Request, res: Response) {
  const admin = currentUser(req);
  const certificate = await prisma.courseCertificate
    .update({ where: { id: param(req, "id") }, data: { revokedAt: null, revokedReason: null } })
    .catch((err: { code?: string }) => {
      if (err.code === "P2025") throw new HttpError(404, "Certificate not found");
      throw err;
    });
  await audit(admin.id, "CERTIFICATE_RESTORED", certificate.id, { certificateNo: certificate.certificateNo });
  res.json({ certificate: certificateView(certificate) });
}

// ---------- Admin: signatory ----------

export async function adminGetCertificateSettings(_req: Request, res: Response) {
  res.json({ signatory: await signatoryView() });
}

const SIGNATURE_TYPES = { "image/png": "png", "image/jpeg": "jpg" } as const;
const MAX_SIGNATURE_BYTES = 500 * 1024;

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Enter the signatory's name").max(80),
  title: z.string().trim().min(2, "Enter the signatory's title").max(80),
  /** A data URL to replace the signature image, null to remove it, omitted to keep it. */
  signature: z.string().max(Math.ceil(MAX_SIGNATURE_BYTES * 1.4) + 100).nullable().optional(),
});

export async function adminSaveCertificateSettings(req: Request, res: Response) {
  const admin = currentUser(req);
  const body = parse(settingsSchema, req.body);
  const current = await getSignatory();
  let signatureKey = current.signatureKey;

  if (body.signature) {
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(body.signature);
    if (!match) throw new HttpError(400, "The signature must be a PNG or JPEG image.");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_SIGNATURE_BYTES) throw new HttpError(400, "The signature image must be 500 KB or smaller.");
    const ext = SIGNATURE_TYPES[match[1] as keyof typeof SIGNATURE_TYPES];
    signatureKey = `certificate-signatures/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    await uploadBuffer(signatureKey, buffer, match[1]);
  } else if (body.signature === null) {
    signatureKey = null;
  }

  const value = { name: body.name, title: body.title, signatureKey };
  await prisma.siteSetting.upsert({
    where: { key: SIGNATORY_SETTING_KEY },
    update: { value },
    create: { key: SIGNATORY_SETTING_KEY, value },
  });
  if (current.signatureKey && current.signatureKey !== signatureKey) {
    await deleteObject(current.signatureKey).catch((err) => console.error("[CERTIFICATE] Failed to delete old signature", err));
  }
  await audit(admin.id, "CERTIFICATE_SETTINGS_UPDATED", SIGNATORY_SETTING_KEY, { name: body.name, title: body.title, signatureChanged: signatureKey !== current.signatureKey });
  res.json({ signatory: await signatoryView() });
}

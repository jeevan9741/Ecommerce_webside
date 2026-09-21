import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { employeeSchema, jobPostingSchema, reviewSchema } from "../utils/validation.js";
import { getDownloadUrl } from "../services/storage.service.js";
import { HttpError, param } from "../utils/http.js";

// ---------- Reviews ----------

export async function listReviews(_req: Request, res: Response) {
  const reviews = await prisma.review.findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }] });
  res.json({ reviews });
}

export async function createReview(req: Request, res: Response) {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const review = await prisma.review.create({ data: parsed.data });
  res.json({ review });
}

export async function updateReview(req: Request, res: Response) {
  const parsed = reviewSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const review = await prisma.review.update({ where: { id: param(req, "id") }, data: parsed.data });
  res.json({ review });
}

export async function deleteReview(req: Request, res: Response) {
  await prisma.review.delete({ where: { id: param(req, "id") } });
  res.json({ ok: true });
}

// ---------- Employees ----------

export async function listEmployees(_req: Request, res: Response) {
  const employees = await prisma.employee.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ employees });
}

export async function createEmployee(req: Request, res: Response) {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const employee = await prisma.employee.create({
    data: { ...parsed.data, joiningDate: new Date(parsed.data.joiningDate) },
  });
  res.json({ employee });
}

export async function updateEmployee(req: Request, res: Response) {
  const parsed = employeeSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { joiningDate, ...rest } = parsed.data;
  const employee = await prisma.employee.update({
    where: { id: param(req, "id") },
    data: { ...rest, ...(joiningDate ? { joiningDate: new Date(joiningDate) } : {}) },
  });
  res.json({ employee });
}

export async function deleteEmployee(req: Request, res: Response) {
  await prisma.employee.delete({ where: { id: param(req, "id") } });
  res.json({ ok: true });
}

// ---------- Job postings & applications ----------

export async function listJobs(_req: Request, res: Response) {
  const jobs = await prisma.jobPosting.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applications: true } } },
  });
  res.json({ jobs });
}

export async function createJob(req: Request, res: Response) {
  const parsed = jobPostingSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const job = await prisma.jobPosting.create({ data: parsed.data });
  res.json({ job });
}

export async function updateJob(req: Request, res: Response) {
  const parsed = jobPostingSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const job = await prisma.jobPosting.update({ where: { id: param(req, "id") }, data: parsed.data });
  res.json({ job });
}

/** Soft delete — existing applications stay attached to the posting. */
export async function deactivateJob(req: Request, res: Response) {
  await prisma.jobPosting.update({ where: { id: param(req, "id") }, data: { isActive: false } });
  res.json({ ok: true });
}

export async function listJobApplications(req: Request, res: Response) {
  const applications = await prisma.jobApplication.findMany({
    where: { jobId: param(req, "id") },
    orderBy: { createdAt: "desc" },
  });
  const withUrls = await Promise.all(
    applications.map(async (a) => ({
      ...a,
      resumeUrl: a.resumeStorageKey ? await getDownloadUrl(a.resumeStorageKey, 300) : null,
    }))
  );
  res.json({ applications: withUrls });
}

const applicationStatusSchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"]),
});

export async function updateApplication(req: Request, res: Response) {
  const parsed = applicationStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const application = await prisma.jobApplication.update({
    where: { id: param(req, "id") },
    data: { status: parsed.data.status },
  });
  res.json({ application });
}

// ---------- Certificates ----------

const certificateSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  storageKey: z.string().min(1),
  displayOrder: z.number().int().optional(),
});

export async function listCertificates(_req: Request, res: Response) {
  const certificates = await prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } });
  res.json({ certificates });
}

export async function createCertificate(req: Request, res: Response) {
  const parsed = certificateSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const certificate = await prisma.certificate.create({ data: parsed.data });
  res.json({ certificate });
}

export async function deleteCertificate(req: Request, res: Response) {
  await prisma.certificate.delete({ where: { id: param(req, "id") } });
  res.json({ ok: true });
}

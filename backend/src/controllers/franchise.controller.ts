import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { intakeStatus, myApplication, myDocumentUrl, publishedRevenueShare, submitApplication, withdrawApplication, type UploadedFile } from "../services/franchise-application.service.js";
import {
  adminLocations,
  applyImport,
  createDistrict,
  createState,
  previewImport,
  activateState,
  publicLocations,
  updateDistrict,
  updateState,
} from "../services/franchise-location.service.js";
import { requireAdminRead } from "../services/franchise-admin-guard.js";

// ---------- Public ----------

/** What the opportunity page and form need: whether intake is open and the published terms (never a guess). */
export async function franchiseInfo(_req: Request, res: Response) {
  const [intake, revenueShare] = await Promise.all([intakeStatus(), publishedRevenueShare()]);
  res.json({ ...intake, revenueShare });
}

export async function franchiseLocations(_req: Request, res: Response) {
  res.json({ states: await publicLocations() });
}

// ---------- Applicant (requireUser) ----------

export async function submitFranchiseApplication(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`franchise-apply:${user.id}`, 5, 60 * 60 * 1000) || !rateLimit(`franchise-apply-ip:${req.ip}`, 20, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many attempts. Please try again later.", { code: "RATE_LIMITED" });
  }
  const files = (Array.isArray(req.files) ? req.files : Object.values(req.files ?? {}).flat()) as UploadedFile[];
  const application = await submitApplication({ userId: user.id, body: (req.body ?? {}) as Record<string, unknown>, files });
  res.status(201).json({ id: application.id, applicationNo: application.applicationNo, status: application.status });
}

export async function myFranchiseApplication(req: Request, res: Response) {
  res.json({ application: await myApplication(currentUser(req).id) });
}

/** The applicant withdraws their own open application (never anyone else's: scoped to the caller). */
export async function withdrawMyApplication(req: Request, res: Response) {
  res.json(await withdrawApplication(currentUser(req).id, req.body));
}

export async function myFranchiseDocumentUrl(req: Request, res: Response) {
  const user = currentUser(req);
  if (!rateLimit(`franchise-doc-url:${user.id}`, 60, 60 * 1000)) throw new HttpError(429, "Too many requests.", { code: "RATE_LIMITED" });
  res.setHeader("Cache-Control", "no-store");
  res.json(await myDocumentUrl(user.id, param(req, "id")));
}

// ---------- Admin locations (under /admin, behind requireAdmin; the service re-checks the role in the database) ----------

export async function listAdminLocations(req: Request, res: Response) {
  res.json({ states: await adminLocations(currentUser(req).id) });
}
export async function addState(req: Request, res: Response) {
  res.status(201).json(await createState(currentUser(req).id, req.body ?? {}));
}
export async function editState(req: Request, res: Response) {
  res.json(await updateState(currentUser(req).id, param(req, "id"), req.body ?? {}));
}
export async function enableState(req: Request, res: Response) {
  res.json(await activateState(currentUser(req).id, param(req, "id"), req.body ?? {}));
}
export async function addDistrict(req: Request, res: Response) {
  res.status(201).json(await createDistrict(currentUser(req).id, req.body ?? {}));
}
export async function editDistrict(req: Request, res: Response) {
  res.json(await updateDistrict(currentUser(req).id, param(req, "id"), req.body ?? {}));
}
export async function previewLocationImport(req: Request, res: Response) {
  await requireAdminRead(currentUser(req).id);
  res.json(await previewImport(req.body?.csv, req.body?.source));
}
export async function applyLocationImport(req: Request, res: Response) {
  res.json(await applyImport(currentUser(req).id, req.body ?? {}));
}

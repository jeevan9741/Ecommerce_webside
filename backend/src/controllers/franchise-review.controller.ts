import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { addNote, adminDocumentUrl, applicationDetail, applicationSummary, listApplications, transitionApplication } from "../services/franchise-review.service.js";
import { cancelDocumentRequest, createDocumentRequest } from "../services/franchise-document-request.service.js";

// Every route here sits under /admin (requireAdmin); the service re-checks the role inside each write.
// Responses hold applicant personal data, so none of them may be cached.

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export async function listFranchiseApplications(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`franchise-review-list:${admin.id}`, 120, 60 * 1000)) throw new HttpError(429, "Too many requests.", { code: "RATE_LIMITED" });
  noStore(res);
  res.json(await listApplications(admin.id, req.query));
}

export async function franchiseApplicationSummary(req: Request, res: Response) {
  noStore(res);
  res.json(await applicationSummary(currentUser(req).id));
}

export async function getFranchiseApplication(req: Request, res: Response) {
  noStore(res);
  res.json({ application: await applicationDetail(currentUser(req).id, param(req, "id")) });
}

/** A 5-minute signed link to one applicant document. POST: each request is a new, audited view. */
export async function franchiseApplicationDocumentUrl(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`franchise-admin-doc-url:${admin.id}`, 60, 60 * 1000)) throw new HttpError(429, "Too many requests.", { code: "RATE_LIMITED" });
  noStore(res);
  res.json(await adminDocumentUrl(admin.id, param(req, "id"), param(req, "documentId")));
}

/** Ask the applicant for more documents and/or information (one open request at a time). */
export async function requestFranchiseDocuments(req: Request, res: Response) {
  const admin = currentUser(req);
  if (!rateLimit(`franchise-doc-request:${admin.id}`, 30, 60 * 60 * 1000)) throw new HttpError(429, "Too many requests.", { code: "RATE_LIMITED" });
  noStore(res);
  res.status(201).json(await createDocumentRequest(admin.id, param(req, "id"), req.body));
}

export async function cancelFranchiseDocumentRequest(req: Request, res: Response) {
  noStore(res);
  res.json(await cancelDocumentRequest(currentUser(req).id, param(req, "id"), param(req, "requestId"), req.body));
}

export async function transitionFranchiseApplication(req: Request, res: Response) {
  noStore(res);
  res.json(await transitionApplication(currentUser(req).id, param(req, "id"), req.body));
}

export async function addFranchiseApplicationNote(req: Request, res: Response) {
  noStore(res);
  res.status(201).json(await addNote(currentUser(req).id, param(req, "id"), req.body));
}

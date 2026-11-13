import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { param } from "../utils/http.js";
import {
  approveAssignmentRequest,
  closeAssignmentRequest,
  franchiseAudit,
  franchiseOverview,
  listAssignmentRequests,
  listAssignments,
  partnerSupportHistory,
  requestAssignmentEnd,
  requestReassignment,
} from "../services/franchise-admin.service.js";

// Every route here sits under /admin (requireAdmin); each service re-checks the ADMIN role in the
// database — inside the transaction for every write — and audits each change.

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export async function getOverview(req: Request, res: Response) {
  noStore(res);
  res.json(await franchiseOverview(currentUser(req).id));
}
export async function getAssignments(req: Request, res: Response) {
  noStore(res);
  res.json(await listAssignments(currentUser(req).id, req.query));
}
export async function postReassignRequest(req: Request, res: Response) {
  res.status(201).json({ request: await requestReassignment(currentUser(req).id, param(req, "id"), req.body) });
}
export async function postEndRequest(req: Request, res: Response) {
  res.status(201).json({ request: await requestAssignmentEnd(currentUser(req).id, param(req, "id"), req.body) });
}
export async function getAssignmentRequests(req: Request, res: Response) {
  noStore(res);
  res.json({ requests: await listAssignmentRequests(currentUser(req).id) });
}
export async function postApproveAssignmentRequest(req: Request, res: Response) {
  res.json(await approveAssignmentRequest(currentUser(req).id, param(req, "id"), req.body));
}
export async function postRejectAssignmentRequest(req: Request, res: Response) {
  res.json(await closeAssignmentRequest(currentUser(req).id, param(req, "id"), "reject", req.body));
}
export async function postCancelAssignmentRequest(req: Request, res: Response) {
  res.json(await closeAssignmentRequest(currentUser(req).id, param(req, "id"), "cancel", req.body));
}
export async function getAudit(req: Request, res: Response) {
  noStore(res);
  res.json(await franchiseAudit(currentUser(req).id, req.query));
}
export async function getPartnerSupport(req: Request, res: Response) {
  noStore(res);
  res.json(await partnerSupportHistory(currentUser(req).id, param(req, "id")));
}

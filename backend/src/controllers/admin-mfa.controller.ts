import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { param } from "../utils/http.js";
import {
  approveMfaReset,
  closeMfaReset,
  confirmEnrollment,
  listAdminsForMfa,
  listMfaResets,
  mfaStatus,
  regenerateRecoveryCodes,
  requestMfaReset,
  startEnrollment,
  verifyLogin,
} from "../services/admin-mfa.service.js";

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

// Sign-in second step (public: the challenge token is the credential).
export async function postVerify(req: Request, res: Response) {
  noStore(res);
  res.json(await verifyLogin(req.body, req.ip ?? "unknown"));
}

// Own enrolment (requireUser; the service checks the ADMIN role in the database).
export async function getStatus(req: Request, res: Response) {
  noStore(res);
  res.json(await mfaStatus(currentUser(req).id, req.sessionMv));
}
export async function postEnrollStart(req: Request, res: Response) {
  noStore(res);
  res.json(await startEnrollment(currentUser(req).id, req.body));
}
export async function postEnrollConfirm(req: Request, res: Response) {
  noStore(res);
  res.json(await confirmEnrollment(currentUser(req).id, req.body));
}

// Behind requireAdmin (so an MFA-verified admin session).
export async function postRecoveryCodes(req: Request, res: Response) {
  noStore(res);
  res.json(await regenerateRecoveryCodes(currentUser(req).id, req.body));
}
export async function getAdmins(req: Request, res: Response) {
  noStore(res);
  res.json({ admins: await listAdminsForMfa(currentUser(req).id) });
}
export async function postResetRequest(req: Request, res: Response) {
  res.status(201).json({ request: await requestMfaReset(currentUser(req).id, param(req, "id"), req.body) });
}
export async function getResetRequests(req: Request, res: Response) {
  noStore(res);
  res.json({ requests: await listMfaResets(currentUser(req).id) });
}
export async function postResetApprove(req: Request, res: Response) {
  res.json(await approveMfaReset(currentUser(req).id, param(req, "id"), req.body));
}
export async function postResetReject(req: Request, res: Response) {
  res.json(await closeMfaReset(currentUser(req).id, param(req, "id"), "reject"));
}
export async function postResetCancel(req: Request, res: Response) {
  res.json(await closeMfaReset(currentUser(req).id, param(req, "id"), "cancel"));
}

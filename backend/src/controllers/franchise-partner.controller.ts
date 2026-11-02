import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import {
  approvePartnerAction,
  closePartnerAction,
  listPartners,
  partnerDetail,
  partnerProfile,
  requestPartnerAction,
  resolvePartnerAccess,
  suspendPartner,
} from "../services/franchise-partner.service.js";

// Partner responses describe one franchise; admin ones hold personal data. Neither may be cached.
const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

// ---------- Partner ----------

/** Any signed-in caller: is this account an active franchise partner? (No audit for ordinary users.) */
export async function partnerAccess(req: Request, res: Response) {
  noStore(res);
  const access = await resolvePartnerAccess(currentUser(req).id);
  res.json(access.ok ? { active: true } : { active: false, reason: access.reason });
}

/** Behind requireFranchisePartner: the caller's own franchise, from the id resolved on the server. */
export async function partnerMe(req: Request, res: Response) {
  if (!req.franchise) throw new HttpError(403, "Franchise access required");
  noStore(res);
  res.json({ partner: await partnerProfile(req.franchise) });
}

// ---------- Admin (under /admin, requireAdmin; the service re-checks the role in the database) ----------

export async function adminListPartners(req: Request, res: Response) {
  noStore(res);
  res.json({ partners: await listPartners(currentUser(req).id) });
}
export async function adminPartnerDetail(req: Request, res: Response) {
  noStore(res);
  res.json({ partner: await partnerDetail(currentUser(req).id, param(req, "id")) });
}
export async function adminSuspendPartner(req: Request, res: Response) {
  noStore(res);
  res.json(await suspendPartner(currentUser(req).id, param(req, "id"), req.body));
}
export async function adminRequestPartnerAction(req: Request, res: Response) {
  noStore(res);
  res.status(201).json({ request: await requestPartnerAction(currentUser(req).id, param(req, "id"), req.body) });
}
export async function adminApprovePartnerAction(req: Request, res: Response) {
  noStore(res);
  res.json(await approvePartnerAction(currentUser(req).id, param(req, "id"), req.body));
}
export async function adminRejectPartnerAction(req: Request, res: Response) {
  noStore(res);
  res.json(await closePartnerAction(currentUser(req).id, param(req, "id"), "reject", req.body));
}
export async function adminCancelPartnerAction(req: Request, res: Response) {
  noStore(res);
  res.json(await closePartnerAction(currentUser(req).id, param(req, "id"), "cancel", req.body));
}

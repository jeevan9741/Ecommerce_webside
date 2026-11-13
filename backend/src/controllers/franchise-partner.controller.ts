import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { listEnrolments, listProgress, partnerEarnings, partnerOverview } from "../services/franchise-partner-dashboard.service.js";
import { HttpError, param } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { acceptInvite, cancelInvite, createInvite, listInvites, listStudents, previewInvite, resendInvite, studentDetail } from "../services/franchise-invite.service.js";
import {
  adminChangeStatus,
  adminListTickets,
  adminReply,
  adminTicketDetail,
  partnerClose,
  partnerCreateTicket,
  partnerListTickets,
  partnerReply,
  partnerTicketDetail,
} from "../services/franchise-ticket.service.js";
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

/** The partner context set by requireFranchisePartner; never anything from the request. */
const ctxOf = (req: Request) => {
  if (!req.franchise) throw new HttpError(403, "Franchise access required");
  return req.franchise;
};

// ---------- Partner: invitations and own students (behind requireFranchisePartner) ----------

export async function partnerCreateInvite(req: Request, res: Response) {
  const ctx = ctxOf(req);
  if (!rateLimit(`franchise-invite:${ctx.partnerId}`, 20, 60 * 60 * 1000)) throw new HttpError(429, "Too many invitations. Try again later.", { code: "RATE_LIMITED" });
  noStore(res);
  res.status(201).json(await createInvite(ctx, currentUser(req).id, req.body));
}
export async function partnerListInvites(req: Request, res: Response) {
  noStore(res);
  res.json({ invites: await listInvites(ctxOf(req)) });
}
export async function partnerResendInvite(req: Request, res: Response) {
  noStore(res);
  res.json(await resendInvite(ctxOf(req), currentUser(req).id, param(req, "id")));
}
export async function partnerCancelInvite(req: Request, res: Response) {
  noStore(res);
  res.json({ invite: await cancelInvite(ctxOf(req), currentUser(req).id, param(req, "id")) });
}
export async function partnerListStudents(req: Request, res: Response) {
  noStore(res);
  res.json(await listStudents(ctxOf(req), req.query));
}
export async function partnerStudentDetail(req: Request, res: Response) {
  noStore(res);
  res.json({ student: await studentDetail(ctxOf(req), currentUser(req).id, param(req, "id")) });
}

// ---------- Partner: dashboard views (behind requireFranchisePartner; own students only, read-only) ----------

export async function partnerOverviewView(req: Request, res: Response) {
  noStore(res);
  res.json(await partnerOverview(ctxOf(req)));
}
export async function partnerEnrolmentList(req: Request, res: Response) {
  noStore(res);
  res.json(await listEnrolments(ctxOf(req), req.query));
}
export async function partnerProgressList(req: Request, res: Response) {
  noStore(res);
  res.json(await listProgress(ctxOf(req), req.query));
}
export async function partnerEarningsView(req: Request, res: Response) {
  noStore(res);
  res.json({ earnings: await partnerEarnings(ctxOf(req)) });
}

// ---------- Partner: support tickets (behind requireFranchisePartner; own tickets only) ----------

const messageLimit = (key: string) => {
  if (!rateLimit(`franchise-ticket-msg:${key}`, 30, 60 * 60 * 1000)) throw new HttpError(429, "Too many messages. Try again later.", { code: "RATE_LIMITED" });
};
export async function partnerTicketCreate(req: Request, res: Response) {
  const ctx = ctxOf(req);
  if (!rateLimit(`franchise-ticket-new:${ctx.partnerId}`, 10, 60 * 60 * 1000) || !rateLimit(`franchise-ticket-new-day:${ctx.partnerId}`, 30, 24 * 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many new tickets. Try again later.", { code: "RATE_LIMITED" });
  }
  noStore(res);
  res.status(201).json({ ticket: await partnerCreateTicket(ctx, currentUser(req).id, req.body) });
}
export async function partnerTicketList(req: Request, res: Response) {
  noStore(res);
  res.json({ tickets: await partnerListTickets(ctxOf(req), req.query) });
}
export async function partnerTicketGet(req: Request, res: Response) {
  noStore(res);
  res.json({ ticket: await partnerTicketDetail(ctxOf(req), param(req, "id")) });
}
export async function partnerTicketReply(req: Request, res: Response) {
  const ctx = ctxOf(req);
  messageLimit(ctx.partnerId);
  noStore(res);
  res.status(201).json(await partnerReply(ctx, currentUser(req).id, param(req, "id"), req.body));
}
export async function partnerTicketClose(req: Request, res: Response) {
  noStore(res);
  res.json(await partnerClose(ctxOf(req), currentUser(req).id, param(req, "id"), req.body));
}

// ---------- Student: an invitation sent to them (signed in; their own account) ----------

const tokenLimit = (req: Request) => {
  const user = currentUser(req);
  if (!rateLimit(`franchise-invite-token:${user.id}`, 30, 60 * 60 * 1000) || !rateLimit(`franchise-invite-token-ip:${req.ip}`, 60, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many attempts. Try again later.", { code: "RATE_LIMITED" });
  }
  return user;
};
export async function studentPreviewInvite(req: Request, res: Response) {
  const user = tokenLimit(req);
  noStore(res);
  res.json({ invite: await previewInvite(user.id, param(req, "token")) });
}
export async function studentAcceptInvite(req: Request, res: Response) {
  const user = tokenLimit(req);
  noStore(res);
  res.json(await acceptInvite(user.id, param(req, "token")));
}

// ---------- Admin (under /admin, requireAdmin; the service re-checks the role in the database) ----------

export async function adminTicketList(req: Request, res: Response) {
  noStore(res);
  res.json(await adminListTickets(currentUser(req).id, req.query));
}
export async function adminTicketGet(req: Request, res: Response) {
  noStore(res);
  res.json({ ticket: await adminTicketDetail(currentUser(req).id, param(req, "id")) });
}
export async function adminTicketReply(req: Request, res: Response) {
  const admin = currentUser(req);
  messageLimit(`admin:${admin.id}`);
  noStore(res);
  res.status(201).json(await adminReply(admin.id, param(req, "id"), req.body));
}
export async function adminTicketStatus(req: Request, res: Response) {
  noStore(res);
  res.json(await adminChangeStatus(currentUser(req).id, param(req, "id"), req.body));
}

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

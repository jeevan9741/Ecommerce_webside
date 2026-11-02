import type { NextFunction, Request, Response } from "express";
import { requireUser } from "./auth.middleware.js";
import { franchisePartnerEnabled } from "../utils/feature-flags.js";
import { auditDenial, denialError, resolvePartnerAccess, type PartnerContext } from "../services/franchise-partner.service.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Set only by requireFranchisePartner, from the database — never from the request. */
    franchise?: PartnerContext;
  }
}

/** Dark launch: until FRANCHISE_PARTNER_ENABLED=true the partner API doesn't exist (plain 404). */
export function partnerFeatureGate(_req: Request, res: Response, next: NextFunction) {
  if (franchisePartnerEnabled()) return next();
  res.status(404).json({ error: "Not found" });
}

/**
 * Franchise Admin access, decided from the database on every request: an ACTIVE partner, inside its
 * agreement dates, holding its ALLOCATED district, owned by a USER (never an ADMIN). Handlers must use
 * req.franchise for every query; no partner or district id is ever read from the URL, query or body.
 */
export function requireFranchisePartner(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    const userId = req.user!.id;
    resolvePartnerAccess(userId)
      .then(async (access) => {
        if (access.ok) {
          req.franchise = access.partner;
          return next();
        }
        await auditDenial(userId, access.reason, access.partnerId, req.originalUrl.split("?")[0]);
        next(denialError(access.reason));
      })
      .catch(next);
  });
}

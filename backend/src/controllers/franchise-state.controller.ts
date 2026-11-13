import type { Request, Response } from "express";
import { currentUser } from "../middleware/auth.middleware.js";
import { param } from "../utils/http.js";
import {
  adminStateAvailability,
  approveStateRelease,
  closeStateRelease,
  listStateReleaseRequests,
  releaseReservation,
  requestStateRelease,
  reserveState,
  stateHistory,
} from "../services/franchise-state.service.js";

// Every route here sits under /admin (requireAdmin); each service re-checks the ADMIN role in the
// database — inside the transaction for every write — and audits the action.

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export async function listStates(req: Request, res: Response) {
  noStore(res);
  res.json({ states: await adminStateAvailability(currentUser(req).id) });
}
export async function getStateHistory(req: Request, res: Response) {
  noStore(res);
  res.json(await stateHistory(currentUser(req).id, param(req, "id")));
}
export async function reserveApplicationState(req: Request, res: Response) {
  res.status(201).json({ allocation: await reserveState(currentUser(req).id, param(req, "id"), req.body) });
}
export async function releaseApplicationReservation(req: Request, res: Response) {
  res.json({ allocation: await releaseReservation(currentUser(req).id, param(req, "id"), req.body) });
}
export async function requestReopen(req: Request, res: Response) {
  res.status(201).json({ request: await requestStateRelease(currentUser(req).id, param(req, "id"), req.body) });
}
export async function listReopenRequests(req: Request, res: Response) {
  noStore(res);
  res.json({ requests: await listStateReleaseRequests(currentUser(req).id) });
}
export async function approveReopen(req: Request, res: Response) {
  res.json(await approveStateRelease(currentUser(req).id, param(req, "id"), req.body));
}
export async function rejectReopen(req: Request, res: Response) {
  res.json(await closeStateRelease(currentUser(req).id, param(req, "id"), "reject", req.body));
}
export async function cancelReopen(req: Request, res: Response) {
  res.json(await closeStateRelease(currentUser(req).id, param(req, "id"), "cancel", req.body));
}

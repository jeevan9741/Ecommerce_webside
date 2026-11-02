import type { Request, Response } from "express";
import { z } from "zod";
import type { PolicyDomain } from "@prisma/client";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError, param } from "../utils/http.js";
import { POLICY_DOMAINS, POLICY_FIELDS, POLICY_SCHEMA_VERSION, APPROVED_STARTING_VALUES, FEATURE_REQUIREMENTS } from "../services/policy-schemas.js";
import {
  approvePublication,
  createDraft,
  decideAgainst,
  discardDraft,
  getPolicy,
  listApprovals,
  listPolicies,
  policyDiff,
  readiness,
  resolvePolicy,
  submitForApproval,
  updateDraft,
} from "../services/policy.service.js";
import { requireAdminRead } from "../services/franchise-admin-guard.js";

// Every route here sits under /admin and therefore behind requireAdmin; the service re-checks roles
// from the database for every decision, and every read below re-checks the caller is still an ADMIN.

const adminReader = (req: Request) => requireAdminRead(currentUser(req).id);

const sha = z.string().regex(/^[0-9a-f]{64}$/, "Expected a SHA-256 hex hash");
const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request", { code: "INVALID_REQUEST" });
  return r.data;
};
const domainOf = (v: unknown): PolicyDomain | undefined => {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || !POLICY_DOMAINS.includes(v as PolicyDomain)) throw new HttpError(400, "Unknown policy domain.", { code: "UNKNOWN_DOMAIN" });
  return v as PolicyDomain;
};

export function policySchema(_req: Request, res: Response) {
  res.json({ schemaVersion: POLICY_SCHEMA_VERSION, domains: POLICY_DOMAINS, fields: POLICY_FIELDS, startingValues: APPROVED_STARTING_VALUES, features: FEATURE_REQUIREMENTS });
}

export async function listPolicyVersions(req: Request, res: Response) {
  await adminReader(req);
  res.json({ policies: await listPolicies(domainOf(req.query.domain)) });
}

export async function policyReadiness(req: Request, res: Response) {
  await adminReader(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(await readiness());
}

export async function resolvePolicyAt(req: Request, res: Response) {
  await adminReader(req);
  const domain = domainOf(req.query.domain);
  if (!domain) throw new HttpError(400, "domain is required", { code: "INVALID_REQUEST" });
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  if (Number.isNaN(at.getTime())) throw new HttpError(400, "Invalid date", { code: "INVALID_REQUEST" });
  res.json({ domain, at, policy: await resolvePolicy(domain, at) });
}

export async function getPolicyVersion(req: Request, res: Response) {
  await adminReader(req);
  res.json({ policy: await getPolicy(param(req, "id")) });
}

export async function getPolicyDiff(req: Request, res: Response) {
  await adminReader(req);
  const against = typeof req.query.against === "string" && req.query.against ? req.query.against : undefined;
  res.json(await policyDiff(param(req, "id"), against));
}

const createSchema = z.object({
  domain: z.string(),
  from: z.enum(["STARTING_VALUES", "CURRENT", "VERSION"]).optional(),
  versionId: z.string().optional(),
  payload: z.unknown().optional(),
});
export async function createPolicyDraft(req: Request, res: Response) {
  const body = parse(createSchema, req.body);
  res.status(201).json({ policy: await createDraft({ ...body, actorId: currentUser(req).id }) });
}

export async function updatePolicyDraft(req: Request, res: Response) {
  const body = parse(z.object({ payload: z.unknown(), expectedSha: sha }), req.body);
  res.json({ policy: await updateDraft({ id: param(req, "id"), actorId: currentUser(req).id, payload: body.payload, expectedSha: body.expectedSha }) });
}

export async function discardPolicyDraft(req: Request, res: Response) {
  const body = parse(z.object({ expectedSha: sha }), req.body);
  res.json(await discardDraft({ id: param(req, "id"), actorId: currentUser(req).id, expectedSha: body.expectedSha }));
}

export async function submitPolicy(req: Request, res: Response) {
  const body = parse(z.object({ expectedSha: sha, reason: z.string(), effectiveFrom: z.string().nullable().optional() }), req.body);
  res.json(await submitForApproval({ id: param(req, "id"), actorId: currentUser(req).id, ...body }));
}

export async function listPolicyApprovals(req: Request, res: Response) {
  await adminReader(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "EXECUTED"].includes(status)) throw new HttpError(400, "Unknown status", { code: "INVALID_REQUEST" });
  res.json({ approvals: await listApprovals(status) });
}

export async function approvePolicy(req: Request, res: Response) {
  const body = parse(z.object({ expectedPayloadSha: sha, note: z.string().max(500).nullable().optional() }), req.body);
  res.json(await approvePublication({ requestId: param(req, "id"), approverId: currentUser(req).id, expectedPayloadSha: body.expectedPayloadSha, note: body.note ?? null }));
}

export async function rejectPolicy(req: Request, res: Response) {
  const body = parse(z.object({ note: z.string().max(500) }), req.body);
  res.json(await decideAgainst({ requestId: param(req, "id"), actorId: currentUser(req).id, note: body.note, mode: "REJECT" }));
}

export async function cancelPolicySubmission(req: Request, res: Response) {
  const body = parse(z.object({ note: z.string().max(500) }), req.body);
  res.json(await decideAgainst({ requestId: param(req, "id"), actorId: currentUser(req).id, note: body.note, mode: "CANCEL" }));
}

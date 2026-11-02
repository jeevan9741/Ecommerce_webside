/**
 * Franchise policy governance (Phase 3): drafts, validation, stale-edit protection, two-admin
 * publication of an exact payload hash, effective dates, history, readiness, server-side gates, audit
 * — through the real HTTP API — plus attempts to bypass the rules directly in the database.
 * Everything is prefixed "zz-test-"; policies are created only by this file's admins and removed after.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { canonicalJson, canonicalSha256 } from "../src/utils/canonical-json.js";
import { APPROVED_STARTING_VALUES, PENDING, validatePolicyPayload } from "../src/services/policy-schemas.js";
import { createDraft, diffPayloads, expireStaleApprovals, requirePolicy, resolvePolicy, submitForApproval } from "../src/services/policy.service.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string };
const people: Record<string, U> = {};
let baselineAdmins = 0;

async function makeUser(name: string, role: "USER" | "ADMIN") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `P${tag.slice(-8)}${userIds.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}

async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const P = "/admin/franchise/policies";
const draft = async (admin: U, domain: string, payload?: unknown) => {
  const r = await call("POST", P, admin, payload === undefined ? { domain } : { domain, payload });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.policy as { id: string; payloadSha256: string; version: number; payload: Record<string, unknown> };
};
const submit = async (admin: U, policy: { id: string; payloadSha256: string }, effectiveFrom?: string) => {
  const r = await call("POST", `${P}/${policy.id}/submit`, admin, { expectedSha: policy.payloadSha256, reason: "Customer-approved configuration", effectiveFrom: effectiveFrom ?? null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.request as { id: string; payloadSha256: string };
};
const approve = (admin: U, requestId: string, sha: string) => call("POST", `/admin/franchise/approvals/${requestId}/approve`, admin, { expectedPayloadSha: sha });
const policyRow = (id: string) => prisma.policyVersion.findUniqueOrThrow({ where: { id } });

before(async () => {
  baselineAdmins = await prisma.user.count({ where: { role: "ADMIN" } });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-policy test cleanup'`;
      const policies = (await tx.policyVersion.findMany({ where: { createdById: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: policies } }] } });
      await tx.settlementBatch.deleteMany({ where: { policyVersionId: { in: policies } } });
      await tx.settlementSchedule.deleteMany({ where: { policyVersionId: { in: policies } } });
      await tx.policyVersion.deleteMany({ where: { id: { in: policies } } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("canonical hashing and validation (unit)", () => {
  test("canonical JSON sorts keys, keeps integers exact and refuses floats/BigInt", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, "x"], c: null } }), '{"a":{"c":null,"d":[2,"x"]},"b":1}');
    assert.equal(canonicalSha256({ x: 1, y: 2 }), canonicalSha256({ y: 2, x: 1 }));
    assert.throws(() => canonicalJson({ fee: 1.5 }), /safe integers/);
    assert.throws(() => canonicalJson({ fee: 2 ** 53 }), /safe integers/);
    assert.throws(() => canonicalJson({ fee: 10n }), /decimal strings/);
  });

  test("approved starting values are valid; every undecided item is PENDING", () => {
    for (const [domain, payload] of Object.entries(APPROVED_STARTING_VALUES)) {
      assert.equal(validatePolicyPayload(domain as never, payload).ok, true, domain);
    }
    assert.deepEqual(APPROVED_STARTING_VALUES.COMMERCIAL.franchiseFeeGst, PENDING);
    assert.deepEqual(APPROVED_STARTING_VALUES.REVENUE_SHARE.netDistributableRevenueFormula, PENDING);
    assert.deepEqual(APPROVED_STARTING_VALUES.SETTLEMENT.executionTime, PENDING);
    assert.deepEqual(APPROVED_STARTING_VALUES.SETTLEMENT.payoutProvider, PENDING);
    assert.deepEqual(APPROVED_STARTING_VALUES.TAX.tds, PENDING);
  });

  test("validation refuses floats, money as numbers, unknown keys, unbalanced shares and values for pending-only decisions", () => {
    const rs = APPROVED_STARTING_VALUES.REVENUE_SHARE;
    const bad = (domain: string, p: unknown) => validatePolicyPayload(domain as never, p).ok;
    assert.equal(bad("REVENUE_SHARE", { ...rs, partnerShareBps: 8000.5 }), false);
    assert.equal(bad("REVENUE_SHARE", { ...rs, partnerShareBps: 7000 }), false, "shares must total 10000");
    assert.equal(bad("REVENUE_SHARE", { ...rs, netDistributableRevenueFormula: { grossMinusGst: true } }), false, "pending-only decision");
    assert.equal(bad("COMMERCIAL", { ...APPROVED_STARTING_VALUES.COMMERCIAL, franchiseFeeInPaise: 10000000 }), false, "money must be a string");
    assert.equal(bad("COMMERCIAL", { ...APPROVED_STARTING_VALUES.COMMERCIAL, franchiseFeeInPaise: "100000.00" }), false);
    assert.equal(bad("COMMERCIAL", { ...APPROVED_STARTING_VALUES.COMMERCIAL, surprise: 1 }), false, "unknown keys refused");
    assert.equal(bad("SETTLEMENT", { ...APPROVED_STARTING_VALUES.SETTLEMENT, executionTime: "25:00" }), false);
  });

  test("diff reports added, removed and changed paths", () => {
    const changes = diffPayloads({ a: 1, b: { c: 2 }, gone: true }, { a: 1, b: { c: 3 }, added: "x" });
    assert.deepEqual(changes.map((c) => `${c.change}:${c.path}`), ["added:added", "changed:b.c", "removed:gone"]);
  });
});

describe("one-admin environment", () => {
  test("with a single admin, submission is refused with SECOND_ADMIN_REQUIRED", async (t) => {
    if (baselineAdmins !== 0) return t.skip(`database already has ${baselineAdmins} admin(s); can't isolate a one-admin state`);
    const solo = await makeUser("solo", "ADMIN");
    const readiness = await call("GET", `${P}/readiness`, solo);
    assert.deepEqual(readiness.body.twoAdmin, { adminCount: 1, available: false });
    const p = await draft(solo, "NOTIFICATION");
    const r = await call("POST", `${P}/${p.id}/submit`, solo, { expectedSha: p.payloadSha256, reason: "only admin" });
    assert.deepEqual([r.status, r.body.code], [409, "SECOND_ADMIN_REQUIRED"]);
    assert.equal((await policyRow(p.id)).status, "DRAFT");
    await call("DELETE", `${P}/${p.id}`, solo, { expectedSha: p.payloadSha256 });
  });
});

describe("policy governance over the API", () => {
  before(async () => {
    await makeUser("admA", "ADMIN");
    await makeUser("admB", "ADMIN");
    await makeUser("admC", "ADMIN");
    await makeUser("user", "USER");
  });

  test("only admins can use the policy API", async () => {
    assert.equal((await call("GET", P, null)).status, 401);
    assert.equal((await call("GET", P, people.user)).status, 403);
    assert.equal((await call("POST", P, people.user, { domain: "COMMERCIAL" })).status, 403);
    assert.equal((await call("GET", `${P}/schema`, people.admA)).status, 200);
  });

  test("financial readiness: every domain published from approved values still blocks every financial feature", async () => {
    const before = await call("GET", `${P}/readiness`, people.admA);
    for (const domain of Object.keys(APPROVED_STARTING_VALUES)) {
      const p = await draft(people.admA, domain);
      const r = await approve(people.admB, (await submit(people.admA, p)).id, p.payloadSha256);
      assert.equal(r.status, 200, `${domain}: ${JSON.stringify(r.body)}`);
    }
    const ready = await call("GET", `${P}/readiness`, people.admA);
    assert.equal(before.status, 200);
    for (const d of ready.body.domains) assert.ok(d.current, `${d.domain} has a version in force`);
    for (const f of ready.body.features) {
      assert.equal(f.policiesComplete, false, `${f.feature} must stay blocked by PENDING decisions`);
      assert.equal(f.activated, false, `${f.feature} is never activated by policy alone`);
      await assert.rejects(requirePolicy(f.feature), (e: { extra?: { code?: string } }) => e.extra?.code === "POLICY_PENDING", f.feature);
    }
    const commercial = ready.body.domains.find((d: { domain: string }) => d.domain === "COMMERCIAL");
    assert.ok(commercial.current.pending.includes("feeRefundPolicy"), "the fee refund policy is not invented: it stays PENDING");
    assert.ok(commercial.current.pending.includes("franchiseFeeGst"));
    const pendingByDomain = Object.fromEntries(ready.body.domains.map((d: { domain: string; current: { pending: string[] } }) => [d.domain, d.current.pending.sort()]));
    assert.deepEqual(pendingByDomain, {
      COMMERCIAL: ["agreementTemplate", "applicationIntake", "districtReservationAndReassignment", "documentRequirements", "eSignProvider", "feeRefundPolicy", "franchiseFeeGst", "renewalTerms"],
      REVENUE_SHARE: ["courseSaleGstTreatment", "netDistributableRevenueFormula", "referralOverlap", "refundChargebackDebtRecovery", "studentAttributionScope"],
      SETTLEMENT: ["executionTime", "payoutProvider", "reserveReleaseDays", "suspendedPartnerPayouts"],
      TAX: ["gstinCollection", "panCollection", "tds"],
      GST_INVOICE: ["invoiceConfiguration"],
      NOTIFICATION: [],
    });
  });

  test("drafts: starting values, validation errors, stale edits and ownership", async () => {
    const p = await draft(people.admA, "COMMERCIAL");
    assert.equal(p.payload.franchiseFeeInPaise, "10000000");
    assert.deepEqual(p.payload.franchiseFeeGst, PENDING);
    assert.equal(p.payloadSha256, canonicalSha256(p.payload));

    const invalid = await call("PUT", `${P}/${p.id}`, people.admA, { payload: { ...p.payload, agreementTermMonths: 60.5 }, expectedSha: p.payloadSha256 });
    assert.deepEqual([invalid.status, invalid.body.code], [400, "INVALID_POLICY"]);

    const edited = await call("PUT", `${P}/${p.id}`, people.admA, { payload: { ...p.payload, feeRefundPolicy: { text: "Refundable in full if the application is rejected before review." } }, expectedSha: p.payloadSha256 });
    assert.equal(edited.status, 200);
    const stale = await call("PUT", `${P}/${p.id}`, people.admA, { payload: p.payload, expectedSha: p.payloadSha256 });
    assert.deepEqual([stale.status, stale.body.code], [409, "STALE"], "editor holding the old hash can't overwrite");
    const notOwner = await call("PUT", `${P}/${p.id}`, people.admB, { payload: p.payload, expectedSha: edited.body.policy.payloadSha256 });
    assert.deepEqual([notOwner.status, notOwner.body.code], [403, "NOT_DRAFT_OWNER"]);
    const staleSubmit = await call("POST", `${P}/${p.id}/submit`, people.admA, { expectedSha: p.payloadSha256, reason: "submit with the old hash" });
    assert.deepEqual([staleSubmit.status, staleSubmit.body.code], [409, "STALE"]);
  });

  test("two-admin publication: self-approval refused, hash pinned, publication immutable, audit trail", async () => {
    const p = await draft(people.admA, "COMMERCIAL");
    const req = await submit(people.admA, p);
    assert.equal(req.payloadSha256, p.payloadSha256);
    const frozen = await call("PUT", `${P}/${p.id}`, people.admA, { payload: p.payload, expectedSha: p.payloadSha256 });
    assert.deepEqual([frozen.status, frozen.body.code], [409, "NOT_DRAFT"]);

    const self = await approve(people.admA, req.id, p.payloadSha256);
    assert.deepEqual([self.status, self.body.code], [403, "SELF_APPROVAL"]);
    const wrongHash = await approve(people.admB, req.id, "0".repeat(64));
    assert.deepEqual([wrongHash.status, wrongHash.body.code], [409, "HASH_MISMATCH"]);
    assert.equal((await policyRow(p.id)).status, "PENDING_APPROVAL", "nothing changed");

    const ok = await approve(people.admB, req.id, p.payloadSha256);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const row = await policyRow(p.id);
    assert.deepEqual([row.status, row.approvedById, row.createdById], ["PUBLISHED", people.admB.id, people.admA.id]);
    const request = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: req.id } });
    assert.deepEqual([request.status, request.decidedById, request.openKey], ["EXECUTED", people.admB.id, null]);
    assert.equal((await approve(people.admC, req.id, p.payloadSha256)).body.code, "ALREADY_DECIDED");

    await assert.rejects(prisma.policyVersion.update({ where: { id: p.id }, data: { payload: { tampered: true } } }), /frozen/);
    await assert.rejects(prisma.policyVersion.delete({ where: { id: p.id } }), /cannot be deleted/);

    const actions = (await prisma.auditLog.findMany({ where: { target: p.id }, orderBy: { createdAt: "asc" } })).map((a) => `${a.action}:${a.actorId === people.admA.id ? "A" : a.actorId === people.admB.id ? "B" : "?"}`);
    assert.deepEqual(actions, ["POLICY_DRAFT_CREATED:A", "POLICY_SUBMITTED:A", "POLICY_PUBLISHED:B"]);
  });

  test("approver and requester are re-checked from the database at approval time", async () => {
    const p = await draft(people.admA, "TAX");
    const req = await submit(people.admA, p);
    await prisma.user.update({ where: { id: people.admB.id }, data: { role: "USER" } }); // token still says ADMIN
    const demotedApprover = await approve(people.admB, req.id, p.payloadSha256);
    assert.deepEqual([demotedApprover.status, demotedApprover.body.code], [403, "NOT_ADMIN"]);
    await prisma.user.update({ where: { id: people.admB.id }, data: { role: "ADMIN" } });
    await prisma.user.update({ where: { id: people.admA.id }, data: { role: "USER" } });
    const demotedRequester = await approve(people.admB, req.id, p.payloadSha256);
    assert.deepEqual([demotedRequester.status, demotedRequester.body.code], [403, "REQUESTER_NOT_ADMIN"]);
    await prisma.user.update({ where: { id: people.admA.id }, data: { role: "ADMIN" } });
    assert.equal((await policyRow(p.id)).status, "PENDING_APPROVAL");
    const rejected = await call("POST", `/admin/franchise/approvals/${req.id}/reject`, people.admB, { note: "TDS not confirmed by the CA yet" });
    assert.deepEqual([rejected.status, rejected.body.status], [200, "REJECTED"]);
    assert.equal((await policyRow(p.id)).status, "REJECTED");
    assert.equal((await approve(people.admB, req.id, p.payloadSha256)).body.code, "ALREADY_DECIDED");
  });

  test("withdrawing: only the requester can cancel; another admin rejects instead", async () => {
    const p = await draft(people.admA, "TAX");
    const req = await submit(people.admA, p);
    assert.equal((await call("POST", `/admin/franchise/approvals/${req.id}/cancel`, people.admB, { note: "not mine" })).body.code, "NOT_REQUESTER");
    assert.equal((await call("POST", `/admin/franchise/approvals/${req.id}/reject`, people.admA, { note: "my own" })).body.code, "USE_CANCEL");
    const cancelled = await call("POST", `/admin/franchise/approvals/${req.id}/cancel`, people.admA, { note: "submitted by mistake" });
    assert.deepEqual([cancelled.status, cancelled.body.status], [200, "CANCELLED"]);
  });

  test("concurrent approvals of ONE request by two admins: exactly one publishes", async () => {
    const p = await draft(people.admA, "REVENUE_SHARE");
    const req = await submit(people.admA, p);
    const results = await Promise.all([approve(people.admB, req.id, p.payloadSha256), approve(people.admC, req.id, p.payloadSha256)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.find((r) => r.status === 409)!.body.code, "ALREADY_DECIDED");
    assert.equal(await prisma.policyVersion.count({ where: { domain: "REVENUE_SHARE", status: "PUBLISHED" } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { target: p.id, action: "POLICY_PUBLISHED" } }), 1);
  });

  test("concurrent publication of TWO versions of one domain: serialised, one current, the other superseded", async () => {
    const v1 = await draft(people.admA, "NOTIFICATION");
    const v2 = await draft(people.admA, "NOTIFICATION");
    assert.notEqual(v1.version, v2.version);
    const [r1, r2] = [await submit(people.admA, v1), await submit(people.admA, v2)];
    const results = await Promise.all([approve(people.admB, r1.id, v1.payloadSha256), approve(people.admC, r2.id, v2.payloadSha256)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results.map((r) => r.body)));
    const rows = await prisma.policyVersion.findMany({ where: { id: { in: [v1.id, v2.id] } } });
    assert.deepEqual(rows.map((r) => r.status).sort(), ["PUBLISHED", "SUPERSEDED"]);
    assert.equal(await prisma.policyVersion.count({ where: { domain: "NOTIFICATION", status: "PUBLISHED" } }), 1);
  });

  test("concurrent draft creation gets distinct, consecutive version numbers", async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => draft(people.admA, "GST_INVOICE")));
    const versions = created.map((c) => c.version).sort((a, b) => a - b);
    assert.equal(new Set(versions).size, 5);
    assert.equal(versions[4] - versions[0], 4);
    for (const c of created) await call("DELETE", `${P}/${c.id}`, people.admA, { expectedSha: c.payloadSha256 });
  });

  test("effective dates: future versions wait; history resolves by time; no retroactive or out-of-order versions", async () => {
    const now = Date.now();
    const v1 = await draft(people.admA, "SETTLEMENT");
    await approve(people.admB, (await submit(people.admA, v1)).id, v1.payloadSha256);
    const v1Row = await policyRow(v1.id);
    const in1h = new Date(now + 3600_000).toISOString();
    const v2 = await draft(people.admA, "SETTLEMENT", { ...APPROVED_STARTING_VALUES.SETTLEMENT, executionTime: "10:00" });
    const v2ok = await approve(people.admB, (await submit(people.admA, v2, in1h)).id, v2.payloadSha256);
    assert.equal(v2ok.status, 200, JSON.stringify(v2ok.body));

    assert.equal((await resolvePolicy("SETTLEMENT", new Date()))!.id, v1.id, "v1 still in force");
    assert.equal((await resolvePolicy("SETTLEMENT", new Date(now + 2 * 3600_000)))!.id, v2.id, "v2 in force after its date");
    assert.notEqual((await resolvePolicy("SETTLEMENT", new Date(v1Row.publishedAt!.getTime() - 1000)))?.id, v1.id, "before v1's publication, an earlier version (or none) applies");
    const ready = await call("GET", `${P}/readiness`, people.admA);
    const settlement = ready.body.domains.find((d: { domain: string }) => d.domain === "SETTLEMENT");
    assert.deepEqual([settlement.current.id, settlement.upcoming.id], [v1.id, v2.id]);

    const v3 = await draft(people.admA, "SETTLEMENT");
    const early = await approve(people.admB, (await submit(people.admA, v3)).id, v3.payloadSha256);
    assert.deepEqual([early.status, early.body.code], [409, "EFFECTIVE_DATE_CONFLICT"], "can't take effect before v2");
    const past = await call("POST", `${P}/${(await draft(people.admA, "SETTLEMENT")).id}/submit`, people.admA, { expectedSha: v3.payloadSha256, reason: "backdated", effectiveFrom: new Date(now - 3600_000).toISOString() });
    assert.equal(past.body.code, "EFFECTIVE_DATE_IN_PAST");
  });

  test("readiness and server-side gates: complete policies never activate a feature", async () => {
    const ready = await call("GET", `${P}/readiness`, people.admA);
    assert.equal(ready.status, 200);
    assert.ok(ready.body.twoAdmin.adminCount >= 3 && ready.body.twoAdmin.available);
    for (const f of ready.body.features) assert.equal(f.activated, false, f.feature);
    const fee = ready.body.features.find((f: { feature: string }) => f.feature === "FRANCHISE_FEE_PAYMENT");
    assert.equal(fee.policiesComplete, false);
    assert.ok(fee.blockers.includes("COMMERCIAL.franchiseFeeGst: PENDING"));
    await assert.rejects(requirePolicy("FRANCHISE_FEE_PAYMENT"), (e: { extra?: { code?: string } }) => e.extra?.code === "POLICY_PENDING");
    await assert.rejects(requirePolicy("GST_INVOICING"), (e: { extra?: { code?: string } }) => ["POLICY_PENDING", "POLICY_MISSING"].includes(e.extra?.code ?? ""));
  });
});

describe("database backstops (bypassing the API)", () => {
  test("policies can't be inserted pre-published, published without a matching approved request, or approved by their creator", async () => {
    const A = people.admA.id, B = people.admB.id;
    const sha = canonicalSha256({ channels: ["EMAIL"] });
    await assert.rejects(
      prisma.policyVersion.create({ data: { domain: "NOTIFICATION", version: 9001, payload: { channels: ["EMAIL"] }, payloadSha256: sha, createdById: A, status: "PUBLISHED", approvedById: B, publishedAt: new Date(), effectiveFrom: new Date() } }),
      /unapproved DRAFTs/
    );
    await assert.rejects(
      prisma.policyVersion.create({ data: { domain: "NOTIFICATION", version: 9002, payload: { channels: ["EMAIL"] }, payloadSha256: sha, createdById: people.user.id } }),
      /only an ADMIN/
    );
    const p = await prisma.policyVersion.create({ data: { domain: "NOTIFICATION", version: 9003, payload: { channels: ["EMAIL"] }, payloadSha256: sha, createdById: A } });
    await assert.rejects(prisma.policyVersion.update({ where: { id: p.id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date() } }), /matching pending publication request/);
    const req = await prisma.adminApprovalRequest.create({
      data: { action: "POLICY_PUBLISH", targetType: "PolicyVersion", targetId: p.id, payload: {}, payloadSha256: sha, reason: "db test", openKey: `POLICY_PUBLISH:PolicyVersion:${p.id}`, requestedById: A, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await prisma.policyVersion.update({ where: { id: p.id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), approvalRequestId: req.id } });
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: A, decidedAt: new Date() } }), /different admin|two_admin/);
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: people.user.id, decidedAt: new Date() } }), /both be ADMIN/);
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: req.id }, data: { payloadSha256: "f".repeat(64) } }), /immutable/);
    await assert.rejects(prisma.policyVersion.update({ where: { id: p.id }, data: { status: "PUBLISHED", approvedById: B, publishedAt: new Date(), effectiveFrom: new Date() } }), /approved request/);
    await prisma.adminApprovalRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedById: B, decidedAt: new Date() } });
    await assert.rejects(prisma.adminApprovalRequest.delete({ where: { id: req.id } }), /cannot be deleted/);
    await assert.rejects(prisma.policyVersion.update({ where: { id: p.id }, data: { status: "PUBLISHED", approvedById: people.admC.id, publishedAt: new Date(), effectiveFrom: new Date() } }), /approved request/, "approver must be the request's decider");
  });
});

describe("approval expiry", () => {
  const TTL = 7 * 24 * 3600_000;
  /** Submits a fresh GST_INVOICE draft as if it had been submitted at `submittedAt` (so it expires TTL later). */
  async function submittedAt(submitted: Date) {
    const p = await createDraft({ domain: "GST_INVOICE", actorId: people.admA.id });
    const { request } = await submitForApproval({ id: p.id, actorId: people.admA.id, expectedSha: p.payloadSha256, reason: "expiry test", now: submitted });
    return { policy: p, request };
  }
  const expiredAudits = (policyId: string) => prisma.auditLog.count({ where: { target: policyId, action: "POLICY_APPROVAL_EXPIRED" } });

  test("approval just before expiry succeeds", async () => {
    const { policy, request } = await submittedAt(new Date(Date.now() - TTL + 15_000)); // expires in ~15 s
    const r = await approve(people.admB, request.id, policy.payloadSha256);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await policyRow(policy.id)).status, "PUBLISHED");
  });

  test("approval after expiry is refused, and the expiry is recorded (request kept, policy rejected, audited)", async () => {
    const { policy, request } = await submittedAt(new Date(Date.now() - TTL - 60_000)); // expired a minute ago
    const r = await approve(people.admB, request.id, policy.payloadSha256);
    assert.deepEqual([r.status, r.body.code], [409, "EXPIRED"]);
    const req = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.deepEqual([req.status, req.openKey, req.decidedById], ["EXPIRED", null, null], "kept, not deleted");
    assert.equal((await policyRow(policy.id)).status, "REJECTED");
    assert.equal(await expiredAudits(policy.id), 1);
    assert.equal((await approve(people.admC, request.id, policy.payloadSha256)).body.code, "ALREADY_DECIDED");
  });

  test("the expiry job and the approvals inbox expire overdue requests", async () => {
    const { policy, request } = await submittedAt(new Date(Date.now() - TTL - 60_000));
    const inbox = await call("GET", "/admin/franchise/approvals?status=PENDING", people.admB);
    assert.equal(inbox.body.approvals.some((a: { id: string }) => a.id === request.id), false, "never offered for approval");
    assert.equal((await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "EXPIRED");
    assert.equal(await expiredAudits(policy.id), 1);
    const again = await expireStaleApprovals();
    assert.equal(again.expired, 0, "idempotent");
  });

  test("concurrent expiry and approval of an expired request: it expires once and is never published", async () => {
    const { policy, request } = await submittedAt(new Date(Date.now() - TTL - 60_000));
    const [r] = await Promise.all([approve(people.admB, request.id, policy.payloadSha256), expireStaleApprovals(), expireStaleApprovals()]);
    assert.equal(r.status, 409);
    assert.ok(["EXPIRED", "ALREADY_DECIDED"].includes(r.body.code), r.body.code);
    assert.equal((await policyRow(policy.id)).status, "REJECTED");
    assert.equal(await expiredAudits(policy.id), 1, "exactly one expiry recorded");
  });

  test("concurrent expiry run and approval of a valid request: the approval wins, nothing expires", async () => {
    const { policy, request } = await submittedAt(new Date());
    const [r, run] = await Promise.all([approve(people.admB, request.id, policy.payloadSha256), expireStaleApprovals()]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(run.expired, 0);
    assert.equal((await policyRow(policy.id)).status, "PUBLISHED");
    assert.equal(await expiredAudits(policy.id), 0);
  });

  test("the database refuses to expire a request early, or to approve an expired one", async () => {
    const live = await submittedAt(new Date());
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: live.request.id }, data: { status: "EXPIRED", openKey: null } }), /not expired yet/);
    const dead = await submittedAt(new Date(Date.now() - TTL - 60_000));
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: dead.request.id }, data: { status: "APPROVED", decidedById: people.admB.id, decidedAt: new Date() } }), /has expired/);
  });
});

describe("database safeguards reached through the API", () => {
  /** Everything that must stay unchanged when a request is refused. */
  const snapshot = async (policyId?: string) => ({
    published: await prisma.policyVersion.count({ where: { status: "PUBLISHED" } }),
    requests: await prisma.adminApprovalRequest.groupBy({ by: ["status"], _count: true, orderBy: { status: "asc" } }),
    audit: await prisma.auditLog.count({ where: { action: { startsWith: "POLICY_" } } }),
    policy: policyId ? (await policyRow(policyId)).status : null,
  });

  test("an admin demoted after login can't draft: refused (403) before the database, which would refuse too; nothing is written", async () => {
    const d = await makeUser("demoted-drafter", "ADMIN");
    await prisma.user.update({ where: { id: d.id }, data: { role: "USER" } }); // the session token still says ADMIN
    const before = await snapshot();
    const r = await call("POST", P, d, { domain: "NOTIFICATION" });
    assert.equal(r.status, 403, JSON.stringify(r.body)); // the service re-reads the role from the database first
    assert.equal(await prisma.policyVersion.count({ where: { createdById: d.id } }), 0);
    assert.deepEqual(await snapshot(), before);
    // The database backstop still refuses the same draft if the service check were ever bypassed.
    await assert.rejects(
      prisma.policyVersion.create({ data: { domain: "NOTIFICATION", version: 9101, payload: { channels: ["EMAIL"] }, payloadSha256: canonicalSha256({ channels: ["EMAIL"] }), createdById: d.id } }),
      /only an ADMIN/
    );
  });

  test("a creator demoted after drafting can't submit: refused (403) and the draft is untouched", async () => {
    const c = await makeUser("demoted-submitter", "ADMIN");
    const p = await draft(c, "TAX");
    await prisma.user.update({ where: { id: c.id }, data: { role: "USER" } });
    const before = await snapshot(p.id);
    const r = await call("POST", `${P}/${p.id}/submit`, c, { expectedSha: p.payloadSha256, reason: "submitted after demotion" });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.deepEqual(await snapshot(p.id), before);
    assert.equal(before.policy, "DRAFT");
    assert.equal(await prisma.adminApprovalRequest.count({ where: { targetId: p.id } }), 0);
  });

  test("refused approvals leave no partial publication and no stray audit rows", async () => {
    const p = await draft(people.admA, "TAX");
    const req = await submit(people.admA, p);
    const before = await snapshot(p.id);
    const attempts = [
      ["self-approval", await approve(people.admA, req.id, p.payloadSha256), 403, "SELF_APPROVAL"],
      ["changed hash", await approve(people.admB, req.id, canonicalSha256({ changed: true })), 409, "HASH_MISMATCH"],
    ] as const;
    await prisma.user.update({ where: { id: people.admC.id }, data: { role: "USER" } });
    const demoted = await approve(people.admC, req.id, p.payloadSha256);
    await prisma.user.update({ where: { id: people.admC.id }, data: { role: "ADMIN" } });
    for (const [what, r, status, code] of attempts) assert.deepEqual([r.status, r.body.code], [status, code], what);
    assert.deepEqual([demoted.status, demoted.body.code], [403, "NOT_ADMIN"]);
    assert.deepEqual(await snapshot(p.id), before, "no publication, request still pending, no audit rows");
    assert.equal(before.policy, "PENDING_APPROVAL");
  });

  test("there is no API path that publishes without an approved request", async () => {
    const p = await draft(people.admA, "TAX");
    const viaEdit = await call("PUT", `${P}/${p.id}`, people.admA, { payload: { ...p.payload, status: "PUBLISHED" }, expectedSha: p.payloadSha256 });
    assert.deepEqual([viaEdit.status, viaEdit.body.code], [400, "INVALID_POLICY"], "status can't be smuggled in the payload");
    assert.equal((await call("POST", `/admin/franchise/approvals/${p.id}/approve`, people.admB, { expectedPayloadSha: p.payloadSha256 })).status, 404, "a policy id is not an approval request");
    assert.equal((await call("POST", `${P}/${p.id}/publish`, people.admB, {})).status, 404, "no publish endpoint exists");
    assert.equal((await policyRow(p.id)).status, "DRAFT");
  });
});

describe("historical references and the maintenance log", () => {
  test("records keep the policy version they were made under", async () => {
    const versions = await prisma.policyVersion.findMany({ where: { domain: "SETTLEMENT", status: { in: ["PUBLISHED", "SUPERSEDED"] }, createdById: { in: userIds } }, select: { id: true }, take: 2 });
    assert.equal(versions.length, 2);
    const schedule = await prisma.settlementSchedule.create({ data: { policyVersionId: versions[0].id, dayOfWeek: 5, timezone: "Asia/Kolkata" } });
    const batch = await prisma.settlementBatch.create({ data: { periodKey: `${tag}-period`, scheduleId: schedule.id, policyVersionId: versions[0].id } });
    await assert.rejects(prisma.settlementSchedule.update({ where: { id: schedule.id }, data: { policyVersionId: versions[1].id } }), /policy version reference cannot change/);
    await assert.rejects(prisma.settlementBatch.update({ where: { id: batch.id }, data: { policyVersionId: versions[1].id } }), /policy version reference cannot change/);
    await assert.rejects(prisma.policyVersion.delete({ where: { id: versions[0].id } }), /cannot be deleted/);
  });

  test("maintenance needs a reason, is logged, and the log itself can never change", async () => {
    const p = await draft(people.admA, "TAX");
    const req = await submit(people.admA, p);
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
        await tx.policyVersion.delete({ where: { id: p.id } });
      }),
      /maintenance_reason/,
      "no reason, no maintenance"
    );
    const reason = `${tag} maintenance check`;
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
        await tx.$executeRaw`SELECT set_config('eta.maintenance_reason', ${reason}, true)`;
        await tx.policyVersion.update({ where: { id: p.id }, data: { payload: { changed: true } } });
      }),
      /frozen/,
      "maintenance never allows changing content"
    );
    // A reasoned maintenance deletion (as superuser on this throwaway database) works and is logged.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
      await tx.$executeRaw`SELECT set_config('eta.maintenance_reason', ${reason}, true)`;
      await tx.policyVersion.delete({ where: { id: p.id } });
      await tx.adminApprovalRequest.delete({ where: { id: req.id } });
    });
    const log = await prisma.$queryRaw<{ id: string; tableName: string; operation: string; rowId: string; dbRole: string }[]>`
      SELECT "id", "tableName", "operation", "rowId", "dbRole" FROM "FinancialMaintenanceLog" WHERE "reason" = ${reason} ORDER BY "occurredAt", "tableName"`;
    assert.deepEqual(log.map((l) => `${l.tableName}:${l.operation}:${l.rowId}`).sort(), [`AdminApprovalRequest:DELETE:${req.id}`, `PolicyVersion:DELETE:${p.id}`].sort());
    assert.ok(log.every((l) => l.dbRole.length > 0));
    await assert.rejects(prisma.$executeRaw`UPDATE "FinancialMaintenanceLog" SET "reason" = 'x' WHERE "id" = ${log[0].id}`, /never allowed/);
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`;
        await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'trying to remove the log'`;
        await tx.$executeRaw`DELETE FROM "FinancialMaintenanceLog" WHERE "id" = ${log[0].id}`;
      }),
      /never allowed/
    );
  });
});

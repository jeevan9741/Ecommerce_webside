/**
 * Franchise Phase 5F-1: the independent Franchise Admin capability — the partner switch, database-verified
 * access (status, agreement dates, district allocation, USER-only), cross-franchise isolation, strict
 * separation from ADMIN, activation preconditions, and the admin suspend / two-admin reinstate and
 * deactivate flows. Real HTTP API and local database; everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { FranchisePartnerStatus } from "@prisma/client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { createDraft } from "../src/services/policy.service.js";
import { activatePartner } from "../src/services/franchise-partner.service.js";

const original = process.env.FRANCHISE_PARTNER_ENABLED;
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string };
const people: Record<string, U> = {};
let stateId = "";
let seq = 0;
let policyVersionId = "";
let templateId = "";
const templateVersion = 900000 + Math.floor(Math.random() * 99999);

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `P${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
const newDistrict = async (label: string) => (await prisma.district.create({ data: { stateId, name: `${tag} ${label}`, isActive: true } })).id;

async function makeApplication(user: U, districtId: string, status: "APPROVED" | "AGREEMENT_PENDING" | "ACTIVE_FRANCHISE" = "ACTIVE_FRANCHISE") {
  const n = ++seq;
  return prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZP-${short}-${String(n).padStart(4, "0")}`,
      userId: user.id,
      status,
      applicantName: `Partner ${n}`,
      mobile: `9${String(600000000 + n)}`,
      email: `${tag}-app${n}@example.test`,
      stateId,
      districtId,
      address: `${n}, Partner Street`,
      requiredDocumentKinds: ["ID_PROOF"],
      refundPolicyVersion: 1,
      refundPolicyText: "test-only refund text",
      refundPolicySha256: "a".repeat(64),
    },
  });
}

/** A partner fixture written directly (activation itself is tested separately). */
async function makePartner(
  name: string,
  opts: { status?: FranchisePartnerStatus; startsAt?: Date; endsAt?: Date; allocation?: "ALLOCATED" | "SUSPENDED" | "OTHER_DISTRICT" | null; role?: "USER" | "ADMIN" } = {}
) {
  const user = await makeUser(name, opts.role ?? "USER");
  const districtId = await newDistrict(name);
  const app = await makeApplication(user, districtId);
  const status = opts.status ?? "ACTIVE";
  const now = new Date();
  const partner = await prisma.franchisePartner.create({
    data: {
      userId: user.id,
      applicationId: app.id,
      franchiseCode: `FR-ZZ${short}${seq}`,
      districtId,
      status,
      agreementStartsAt: opts.startsAt ?? new Date(now.getTime() - DAY),
      agreementEndsAt: opts.endsAt ?? new Date(now.getTime() + 365 * DAY),
      ...(status === "SUSPENDED" ? { suspendedAt: now } : {}),
      ...(status === "DEACTIVATED" ? { deactivatedAt: now } : {}),
    },
  });
  const alloc = opts.allocation === undefined ? "ALLOCATED" : opts.allocation;
  if (alloc === "ALLOCATED" || alloc === "SUSPENDED") {
    await prisma.districtAllocation.create({
      data: { districtId, partnerId: partner.id, applicationId: app.id, status: alloc, allocatedAt: now, ...(alloc === "SUSPENDED" ? { suspendedAt: now } : {}), createdById: people.admA.id },
    });
  } else if (alloc === "OTHER_DISTRICT") {
    await prisma.districtAllocation.create({ data: { districtId: await newDistrict(`${name}-other`), partnerId: partner.id, status: "ALLOCATED", allocatedAt: now, createdById: people.admA.id } });
  }
  return { user, partner, app, districtId };
}

async function call(method: string, path: string, user: U | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...headers, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text, headers: res.headers };
}
const me = (u: U | null, q = "", headers: Record<string, string> = {}) => call("GET", `/franchise-partner/me${q}`, u, undefined, headers);
const P = "/admin/franchise/partners";
const R = "/admin/franchise/partner-requests";
const reason = "Verified with the franchise owner by phone";

before(async () => {
  process.env.FRANCHISE_PARTNER_ENABLED = "true";
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  await makeUser("student");
  stateId = (await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } })).id;
  policyVersionId = (await createDraft({ domain: "COMMERCIAL", actorId: people.admA.id })).id;
  templateId = (await prisma.franchiseAgreementTemplate.create({ data: { version: templateVersion, title: `${tag} template`, body: "test-only template", createdById: people.admA.id } })).id;
});

after(async () => {
  if (original === undefined) delete process.env.FRANCHISE_PARTNER_ENABLED;
  else process.env.FRANCHISE_PARTNER_ENABLED = original;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-partner test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      await tx.adminApprovalRequest.deleteMany({ where: { OR: [{ targetId: { in: partners } }, { requestedById: { in: userIds } }] } });
      await tx.franchisePartnerEvent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.districtAllocationEvent.deleteMany({ where: { districtId: { in: districts } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseAgreement.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchisePayment.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.franchiseAgreementTemplate.deleteMany({ where: { id: templateId } });
      await tx.policyVersion.deleteMany({ where: { id: policyVersionId } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...partners, ...apps] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("partner switch", () => {
  test("OFF: the partner API is a plain 404 for everyone; admin partner routes still work", async () => {
    const { user } = await makePartner("switchoff");
    process.env.FRANCHISE_PARTNER_ENABLED = "false";
    try {
      for (const u of [user, people.student, people.admA, null]) {
        assert.equal((await me(u)).status, 404);
        assert.equal((await call("GET", "/franchise-partner/access", u)).status, 404);
      }
      assert.equal((await call("GET", P, people.admA)).status, 200);
    } finally {
      process.env.FRANCHISE_PARTNER_ENABLED = "true";
    }
    assert.equal((await me(user)).status, 200, "back on");
  });
});

describe("database-verified access", () => {
  test("an active partner sees only its own franchise; ids in the request are ignored", async () => {
    const a = await makePartner("pa");
    const b = await makePartner("pb");
    const ra = await me(a.user);
    assert.equal(ra.status, 200, ra.text);
    assert.equal(ra.body.partner.franchiseCode, a.partner.franchiseCode);
    assert.equal(ra.headers.get("cache-control"), "no-store");
    // Tampering: B's ids in the query string or headers change nothing.
    for (const [q, h] of [[`?partnerId=${b.partner.id}`, {}], [`?districtId=${b.districtId}`, {}], ["", { "X-Partner-Id": b.partner.id }]] as [string, Record<string, string>][]) {
      const r = await me(a.user, q, h);
      assert.equal(r.body.partner.franchiseCode, a.partner.franchiseCode, `tamper ${q || JSON.stringify(h)}`);
    }
    assert.doesNotMatch(ra.text, new RegExp(b.partner.franchiseCode), "nothing about the other franchise");
    assert.equal((await me(b.user)).body.partner.franchiseCode, b.partner.franchiseCode);
    assert.deepEqual((await call("GET", "/franchise-partner/access", a.user)).body, { active: true });
  });

  test("everyone else is refused: anonymous, customers, applicants, admins", async () => {
    assert.equal((await me(null)).status, 401);
    const r1 = await me(people.student);
    assert.deepEqual([r1.status, r1.body.code], [403, "NOT_A_FRANCHISE_PARTNER"]);
    const applicant = await makeUser("approvedApplicant");
    await makeApplication(applicant, await newDistrict("approved"), "APPROVED");
    assert.deepEqual([(await me(applicant)).status, (await me(applicant)).body.code], [403, "NOT_A_FRANCHISE_PARTNER"], "an approved application grants nothing");
    assert.deepEqual([(await me(people.admA)).status, (await me(people.admA)).body.code], [403, "NOT_A_FRANCHISE_PARTNER"]);
    assert.deepEqual((await call("GET", "/franchise-partner/access", people.student)).body, { active: false, reason: "NOT_A_PARTNER" });
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_PARTNER_ACCESS_DENIED", actorId: { in: [people.student.id, applicant.id] } } }), 0, "ordinary refusals aren't audited");
  });

  test("status, agreement dates, allocation and role are each enforced (and audited)", async () => {
    const cases: [string, Parameters<typeof makePartner>[1], string][] = [
      ["suspended", { status: "SUSPENDED", allocation: "SUSPENDED" }, "PARTNER_SUSPENDED"],
      ["deactivated", { status: "DEACTIVATED", allocation: "SUSPENDED" }, "PARTNER_DEACTIVATED"],
      ["expiredStatus", { status: "EXPIRED" }, "PARTNER_EXPIRED"],
      ["notStarted", { startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 400 * DAY) }, "AGREEMENT_NOT_STARTED"],
      ["ended", { startsAt: new Date(Date.now() - 400 * DAY), endsAt: new Date(Date.now() - DAY) }, "AGREEMENT_ENDED"],
      ["noAllocation", { allocation: null }, "DISTRICT_NOT_ALLOCATED"],
      ["allocSuspended", { allocation: "SUSPENDED" }, "DISTRICT_NOT_ALLOCATED"],
      ["otherDistrict", { allocation: "OTHER_DISTRICT" }, "DISTRICT_NOT_ALLOCATED"],
      ["adminOwner", { role: "ADMIN" }, "ADMIN_ACCOUNT"],
    ];
    for (const [name, opts, code] of cases) {
      const { user, partner } = await makePartner(name, opts);
      const r = await me(user);
      assert.deepEqual([r.status, r.body.code], [403, code], `${name}: ${r.text}`);
      assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_PARTNER_ACCESS_DENIED", target: partner.id } }), 1, `${name} audited`);
      assert.deepEqual((await call("GET", "/franchise-partner/access", user)).body.active, false);
    }
  });

  test("changes take effect on the very next request (no stale token)", async () => {
    const { user, partner } = await makePartner("live");
    assert.equal((await me(user)).status, 200);
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    assert.equal((await me(user)).body.code, "ADMIN_ACCOUNT", "promotion to ADMIN ends partner access at once");
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });
    await prisma.franchisePartner.update({ where: { id: partner.id }, data: { agreementEndsAt: new Date(Date.now() - 1000) } });
    assert.equal((await me(user)).body.code, "AGREEMENT_ENDED");
  });

  test("partners can't reach any admin route; admins can't use the partner API", async () => {
    const { user } = await makePartner("noadmin");
    for (const path of [P, `${P}/x`, "/admin/franchise/applications", "/admin/franchise/locations", "/admin/franchise/policies", "/admin/orders"]) {
      assert.equal((await call("GET", path, user)).status, 403, path);
    }
    assert.equal((await call("POST", `${P}/x/suspend`, user, { reason })).status, 403);
    assert.equal((await me(people.admA)).status, 403);
  });
});

describe("activation (service only; no route in 5F-1)", () => {
  async function readyApplication(name: string, opts: { paid?: boolean; accepted?: boolean; reservation?: "ok" | "expired" | "none"; status?: "APPROVED" | "AGREEMENT_PENDING"; role?: "USER" | "ADMIN" } = {}) {
    const user = await makeUser(name, opts.role ?? "USER");
    const districtId = await newDistrict(name);
    const app = await makeApplication(user, districtId, opts.status ?? "AGREEMENT_PENDING");
    const now = Date.now();
    if (opts.paid !== false) {
      await prisma.franchisePayment.create({
        data: {
          applicationId: app.id, status: "PAID", baseAmountInPaise: 10000000, gstAmountInPaise: 0, totalAmountInPaise: 10000000, gstMode: "EXCLUSIVE", gstRateBps: 0, policyVersionId,
          refundPolicyVersion: 1, refundPolicyText: "test", refundPolicySha256: "a".repeat(64), razorpayOrderId: `order_${tag}_${seq}`, razorpayPaymentId: `pay_${tag}_${seq}`, paidAt: new Date(),
        },
      });
    }
    const text = `${tag} agreement ${name}`;
    await prisma.franchiseAgreement.create({
      data: {
        applicationId: app.id, templateId, templateVersion, policyVersionId, termMonths: 60, renderedText: text, contentSha256: sha(text),
        ...(opts.accepted !== false ? { acceptedAt: new Date(), acceptedById: user.id, acceptedName: name, acceptedContentSha256: sha(text) } : {}),
      },
    });
    if ((opts.reservation ?? "ok") !== "none") {
      await prisma.districtAllocation.create({
        data: { districtId, applicationId: app.id, status: "RESERVED", reservedAt: new Date(now - DAY), reservedUntil: new Date(opts.reservation === "expired" ? now - 1000 : now + 7 * DAY), createdById: people.admA.id },
      });
    }
    return { user, app, districtId };
  }

  test("creates the partner, allocates the reserved district and activates the application in one step", async () => {
    const { user, app, districtId } = await readyApplication("activate");
    const p = await activatePartner({ applicationId: app.id, actorId: people.admA.id });
    assert.match(p.franchiseCode, /^FR-[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(p.userId, user.id);
    const months = (p.agreementEndsAt.getUTCFullYear() - p.agreementStartsAt.getUTCFullYear()) * 12 + p.agreementEndsAt.getUTCMonth() - p.agreementStartsAt.getUTCMonth();
    assert.equal(months, 60);
    const alloc = await prisma.districtAllocation.findFirstOrThrow({ where: { districtId } });
    assert.deepEqual([alloc.status, alloc.partnerId], ["ALLOCATED", p.id]);
    const row = await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id }, include: { history: true } });
    assert.equal(row.status, "ACTIVE_FRANCHISE");
    assert.ok(row.history.some((h) => h.toStatus === "ACTIVE_FRANCHISE"));
    assert.equal(await prisma.franchisePartnerEvent.count({ where: { partnerId: p.id, type: "ACTIVATED" } }), 1);
    assert.equal(await prisma.districtAllocationEvent.count({ where: { allocationId: alloc.id, toStatus: "ALLOCATED" } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_PARTNER_ACTIVATED", target: p.id } }), 1);
    const r = await me(user);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.partner.franchiseCode, p.franchiseCode);
  });

  test("every precondition is enforced, and a refusal changes nothing", async () => {
    const cases: [string, Parameters<typeof readyApplication>[1], string][] = [
      ["notReady", { status: "APPROVED" }, "NOT_READY"],
      ["unpaid", { paid: false }, "FEE_NOT_PAID"],
      ["notAccepted", { accepted: false }, "AGREEMENT_NOT_ACCEPTED"],
      ["noReservation", { reservation: "none" }, "NO_RESERVATION"],
      ["expiredReservation", { reservation: "expired" }, "RESERVATION_EXPIRED"],
      ["adminApplicant", { role: "ADMIN" }, "ADMIN_ACCOUNT"],
    ];
    for (const [name, opts, code] of cases) {
      const { user, app } = await readyApplication(name, opts);
      await assert.rejects(activatePartner({ applicationId: app.id, actorId: null }), (e: { extra?: { code?: string } }) => e.extra?.code === code, name);
      assert.equal(await prisma.franchisePartner.count({ where: { userId: user.id } }), 0, `${name}: no partner`);
      assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, opts.status ?? "AGREEMENT_PENDING");
    }
  });

  test("double activation at the same moment: exactly one partner", async () => {
    const { user, app } = await readyApplication("double");
    const results = await Promise.allSettled([activatePartner({ applicationId: app.id, actorId: null }), activatePartner({ applicationId: app.id, actorId: null })]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(await prisma.franchisePartner.count({ where: { userId: user.id } }), 1);
  });
});

describe("admin partner actions", () => {
  test("customers, partners and demoted admins can't use the admin partner routes", async () => {
    const { user, partner } = await makePartner("adminacl");
    const exAdmin = await makeUser("exadmin", "ADMIN");
    await prisma.user.update({ where: { id: exAdmin.id }, data: { role: "USER" } });
    const routes: [string, string, unknown?][] = [["GET", P], ["GET", `${P}/${partner.id}`], ["POST", `${P}/${partner.id}/suspend`, { reason }], ["POST", `${P}/${partner.id}/requests`, { action: "DEACTIVATE", reason }]];
    for (const [method, path, body] of routes) {
      for (const who of [people.student, user, exAdmin]) assert.equal((await call(method, path, who, body)).status, 403, `${method} ${path}`);
      assert.equal((await call(method, path, null, body)).status, 401);
    }
    assert.equal((await prisma.franchisePartner.findUniqueOrThrow({ where: { id: partner.id } })).status, "ACTIVE");
  });

  test("list and detail; viewing a partner is audited", async () => {
    const { partner } = await makePartner("listed");
    const list = await call("GET", P, people.admA);
    assert.ok(list.body.partners.some((p: { id: string }) => p.id === partner.id));
    const d = await call("GET", `${P}/${partner.id}`, people.admA);
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.partner.franchiseCode, partner.franchiseCode);
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_PARTNER_VIEWED", target: partner.id } }), 1);
    assert.equal((await call("GET", `${P}/does-not-exist`, people.admA)).status, 404);
  });

  test("suspension: one admin, immediate, district stays held", async () => {
    const { user, partner, districtId } = await makePartner("suspend");
    assert.equal((await call("POST", `${P}/${partner.id}/suspend`, people.admA, { reason: "short" })).status, 400);
    const r = await call("POST", `${P}/${partner.id}/suspend`, people.admA, { reason });
    assert.equal(r.status, 200, r.text);
    assert.equal((await me(user)).body.code, "PARTNER_SUSPENDED", "access ends on the next request");
    const alloc = await prisma.districtAllocation.findFirstOrThrow({ where: { districtId } });
    assert.equal(alloc.status, "SUSPENDED", "the district is still held");
    assert.equal(await prisma.franchisePartnerEvent.count({ where: { partnerId: partner.id, type: "SUSPENDED" } }), 1);
    assert.deepEqual([(await call("POST", `${P}/${partner.id}/suspend`, people.admA, { reason })).body.code], ["STALE"]);
  });

  test("reinstatement needs a second admin approving the exact request", async () => {
    const { user, partner } = await makePartner("reinstate", { status: "SUSPENDED", allocation: "SUSPENDED" });
    assert.equal((await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason: "x" })).status, 400);
    const req = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    assert.equal(req.status, 201, req.text);
    const dup = await call("POST", `${P}/${partner.id}/requests`, people.admB, { action: "REINSTATE", reason });
    assert.deepEqual([dup.status, dup.body.code], [409, "REQUEST_EXISTS"]);
    const self = await call("POST", `${R}/${req.body.request.id}/approve`, people.admA, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.deepEqual([self.status, self.body.code], [403, "SAME_ADMIN"]);
    const wrong = await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: "b".repeat(64) });
    assert.deepEqual([wrong.status, wrong.body.code], [409, "PAYLOAD_MISMATCH"]);
    assert.equal((await me(user)).body.code, "PARTNER_SUSPENDED", "nothing changed yet");
    const ok = await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await me(user)).status, 200, "access restored");
    const row = await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: req.body.request.id } });
    assert.deepEqual([row.status, row.decidedById, row.openKey], ["EXECUTED", people.admB.id, null]);
    const ev = await prisma.franchisePartnerEvent.findFirstOrThrow({ where: { partnerId: partner.id, type: "REINSTATED" } });
    assert.equal(ev.approvalRequestId, req.body.request.id);
    assert.equal((await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 })).body.code, "NOT_PENDING");
  });

  test("deactivation (two admins) ends access and keeps the district held; a deactivated franchise can't be reinstated", async () => {
    const { user, partner, districtId } = await makePartner("deactivate");
    const req = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "DEACTIVATE", reason });
    const ok = await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await me(user)).body.code, "PARTNER_DEACTIVATED");
    const alloc = await prisma.districtAllocation.findFirstOrThrow({ where: { districtId } });
    assert.equal(alloc.status, "SUSPENDED", "not released as a side effect");
    const pub = await prisma.districtAllocation.count({ where: { districtId, role: "PRIMARY", status: { in: ["RESERVED", "ALLOCATED", "SUSPENDED"] } } });
    assert.equal(pub, 1, "nobody else can be allocated this district");
    const again = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    assert.deepEqual([again.status, again.body.code], [409, "INVALID_ACTION"]);
  });

  test("a request goes stale if the franchise changed; reject and cancel follow the two-admin rules", async () => {
    const { partner } = await makePartner("stale");
    const req = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "DEACTIVATE", reason });
    assert.equal((await call("POST", `${P}/${partner.id}/suspend`, people.admB, { reason })).status, 200);
    const stale = await call("POST", `${R}/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.deepEqual([stale.status, stale.body.code], [409, "STALE"]);
    assert.equal((await prisma.franchisePartner.findUniqueOrThrow({ where: { id: partner.id } })).status, "SUSPENDED");
    assert.deepEqual([(await call("POST", `${R}/${req.body.request.id}/cancel`, people.admB, {})).body.code], ["NOT_REQUESTER"]);
    assert.deepEqual([(await call("POST", `${R}/${req.body.request.id}/reject`, people.admA, {})).body.code], ["SAME_ADMIN"]);
    const rej = await call("POST", `${R}/${req.body.request.id}/reject`, people.admB, { note: "Suspended instead" });
    assert.equal(rej.body.status, "REJECTED");
    const second = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    assert.equal(second.status, 201, "a new request is allowed once the old one is closed");
    assert.equal((await call("POST", `${R}/${second.body.request.id}/cancel`, people.admA, {})).body.status, "CANCELLED");
  });

  test("an expired request is refused, and no longer blocks a new one", async () => {
    const { partner } = await makePartner("expiry", { status: "SUSPENDED", allocation: "SUSPENDED" });
    const payload = { action: "REINSTATE", partnerId: partner.id, fromStatus: "SUSPENDED" };
    const { canonicalSha256 } = await import("../src/utils/canonical-json.js");
    const old = await prisma.adminApprovalRequest.create({
      data: { action: "PARTNER_REINSTATE", targetType: "FranchisePartner", targetId: partner.id, payload, payloadSha256: canonicalSha256(payload), reason, openKey: `partner:${partner.id}`, requestedById: people.admA.id, expiresAt: new Date(Date.now() - 1000) },
    });
    assert.deepEqual([(await call("POST", `${R}/${old.id}/approve`, people.admB, { expectedPayloadSha: old.payloadSha256 })).body.code], ["EXPIRED"]);
    const fresh = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    assert.equal(fresh.status, 201, fresh.text);
    assert.equal((await prisma.adminApprovalRequest.findUniqueOrThrow({ where: { id: old.id } })).status, "EXPIRED");
  });

  test("partner requests never appear in the policy approvals inbox, and the database refuses self-approval", async () => {
    const { partner } = await makePartner("inbox", { status: "SUSPENDED", allocation: "SUSPENDED" });
    const req = await call("POST", `${P}/${partner.id}/requests`, people.admA, { action: "REINSTATE", reason });
    const inbox = await call("GET", "/admin/franchise/approvals", people.admB);
    assert.equal(inbox.status, 200);
    assert.ok(!inbox.body.approvals.some((a: { id: string }) => a.id === req.body.request.id));
    await assert.rejects(prisma.adminApprovalRequest.update({ where: { id: req.body.request.id }, data: { status: "APPROVED", decidedById: people.admA.id } }), /different admin|two_admin/);
    const ev = await prisma.franchisePartnerEvent.create({ data: { partnerId: partner.id, type: "SUSPENDED", toStatus: "SUSPENDED", actorId: people.admA.id, reason } });
    await assert.rejects(prisma.franchisePartnerEvent.update({ where: { id: ev.id }, data: { reason: "edited" } }), /append-only/);
    await assert.rejects(prisma.franchisePartnerEvent.delete({ where: { id: ev.id } }), /append-only/);
  });
});

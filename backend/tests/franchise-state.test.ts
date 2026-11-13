/**
 * State-level franchise exclusivity: one PRIMARY franchise per Indian state. Covers activation closing a
 * state, other states staying open, the per-state lock and partial unique index under concurrency,
 * rejection / withdrawal / suspension never reopening a state, the two-admin reopen, and partner and
 * customer isolation from every state control. Synthetic local data only; everything is "zz-test-".
 * Activation has no route yet (fee payment and agreements don't exist), so it is exercised through the
 * service with test-only PAID-fee and accepted-agreement fixtures, exactly as the partner tests do.
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
process.env.FRANCHISE_PUBLIC_ENABLED = "true";
process.env.FRANCHISE_PARTNER_ENABLED = "true";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { linkFixture } = await import("./franchise-fixtures.js");
const { signSessionToken } = await import("../src/utils/tokens.js");
const { createDraft } = await import("../src/services/policy.service.js");
const { activatePartner } = await import("../src/services/franchise-partner.service.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
const people: Record<string, U> = {};
const st: Record<string, { id: string; district: string }> = {};
let seq = 0;
let policyVersionId = "";
let templateId = "";
const templateVersion = 800000 + Math.floor(Math.random() * 99999);
const reason = "Verified with both parties by phone; documented in the file.";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({ data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `S${short}${userIds.length}`, role, emailVerified: new Date() } });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}
async function makeState(key: string) {
  const s = await prisma.indiaState.create({ data: { name: `${tag} ${key}`, isActive: true } });
  const d = await prisma.district.create({ data: { stateId: s.id, name: `${tag} ${key} centre`, isActive: true } });
  st[key] = { id: s.id, district: d.id };
}
/** An application in a state, at a pipeline status, created directly (the review flow is tested elsewhere). */
async function makeApp(user: U, key: string, status: "APPLICATION_SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "AGREEMENT_PENDING" = "AGREEMENT_PENDING", ready = true) {
  const n = ++seq;
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZS-${short}-${String(n).padStart(4, "0")}`, userId: user.id, status, applicantName: `Applicant ${n}`, mobile: `9${String(600000000 + n)}`, email: user.email,
      stateId: st[key].id, districtId: st[key].district, address: `${n}, Test Street`, requiredDocumentKinds: ["ID_PROOF"],
      history: { create: { toStatus: "APPLICATION_SUBMITTED", actorId: user.id, actorType: "APPLICANT" } },
    },
  });
  if (ready && status === "AGREEMENT_PENDING") {
    // Test-only fixtures standing in for the fee-payment and agreement systems that don't exist yet.
    await prisma.franchisePayment.create({
      data: { applicationId: app.id, status: "PAID", baseAmountInPaise: 10000000, gstAmountInPaise: 0, totalAmountInPaise: 10000000, gstMode: "EXCLUSIVE", gstRateBps: 0, policyVersionId, refundPolicyVersion: 1, refundPolicyText: "test", refundPolicySha256: "a".repeat(64), razorpayOrderId: `order_${tag}_${n}`, razorpayPaymentId: `pay_${tag}_${n}`, paidAt: new Date() },
    });
    const text = `${tag} agreement ${n}`;
    await prisma.franchiseAgreement.create({ data: { applicationId: app.id, templateId, templateVersion, policyVersionId, termMonths: 60, renderedText: text, contentSha256: sha(text), acceptedAt: new Date(), acceptedById: user.id, acceptedName: `Applicant ${n}`, acceptedContentSha256: sha(text) } });
  }
  return app;
}
async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.9.${seq % 250}.${Math.floor(Math.random() * 250)}`, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}
const reserve = (admin: U, appId: string) => call("POST", `/admin/franchise/applications/${appId}/reserve-state`, admin, { reason, days: 30 });
const publicAvailability = async (key: string) => ((await call("GET", "/franchise/locations", null)).body.states as { id: string; availability: string }[]).find((s) => s.id === st[key].id)?.availability;
const adminStatus = async (key: string) => ((await call("GET", "/admin/franchise/states", people.admA)).body.states as { id: string; status: string }[]).find((s) => s.id === st[key].id)?.status;
const holding = (key: string) => prisma.stateAllocation.findFirst({ where: { stateId: st[key].id, status: { in: ["RESERVED", "ALLOCATED", "SUSPENDED"] } } });

const fx = {} as { partnerA: { user: U; id: string }; partnerB: { user: U; id: string } };

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  await makeUser("student");
  for (const key of ["Karnataka", "Maharashtra", "Goa", "Kerala", "Assam", "Bihar"]) await makeState(key);
  policyVersionId = (await createDraft({ domain: "COMMERCIAL", actorId: people.admA.id })).id;
  templateId = (await prisma.franchiseAgreementTemplate.create({ data: { version: templateVersion, title: `${tag} template`, body: "test-only template", createdById: people.admA.id } })).id;
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-state test cleanup'`;
      const partners = (await tx.franchisePartner.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const states = Object.values(st).map((s) => s.id);
      await tx.adminApprovalRequest.deleteMany({ where: { OR: [{ targetId: { in: [...partners, ...states] } }, { requestedById: { in: userIds } }] } });
      await tx.stateAllocationEvent.deleteMany({ where: { stateId: { in: states } } });
      await tx.stateAllocation.deleteMany({ where: { stateId: { in: states } } });
      await tx.franchiseStudent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchisePartnerEvent.deleteMany({ where: { partnerId: { in: partners } } });
      await tx.franchisePartner.deleteMany({ where: { id: { in: partners } } });
      await tx.franchiseAgreement.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchisePayment.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchisePrivacyNoticeAcceptance.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.franchiseAgreementTemplate.deleteMany({ where: { id: templateId } });
      await tx.policyVersion.deleteMany({ where: { id: policyVersionId } });
      await tx.district.deleteMany({ where: { stateId: { in: states } } });
      await tx.indiaState.deleteMany({ where: { id: { in: states } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...partners, ...apps, ...states] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("1–5: activation closes exactly one state", () => {
  test("1. Partner A is activated for Karnataka (reservation → allocation, audited)", async () => {
    const user = await makeUser("partnerA");
    const app = await makeApp(user, "Karnataka");
    const r = await reserve(people.admA, app.id);
    assert.equal(r.status, 201, r.text);
    assert.equal(await publicAvailability("Karnataka"), "RESERVED", "a reservation is temporary, not CLOSED");
    const p = await activatePartner({ applicationId: app.id, actorId: people.admA.id });
    fx.partnerA = { user, id: p.id };
    const h = await holding("Karnataka");
    assert.deepEqual([h?.status, h?.partnerId], ["ALLOCATED", p.id]);
    assert.equal((await call("GET", "/franchise-partner/me", user)).status, 200, "the partner's dashboard opens");
    assert.equal(await prisma.auditLog.count({ where: { action: "FRANCHISE_STATE_RESERVED", target: r.body.allocation.id } }), 1);
  });

  test("2. Karnataka becomes CLOSED — publicly and for admins — and takes no new applications", async () => {
    assert.equal(await publicAvailability("Karnataka"), "CLOSED");
    assert.equal(await adminStatus("Karnataka"), "ACTIVATED_CLOSED");
    const res = await call("GET", "/franchise/locations", null);
    const k = (res.body.states as { id: string; districts: { available: boolean }[] }[]).find((s) => s.id === st.Karnataka.id)!;
    assert.ok(k.districts.every((d) => !d.available), "no centre district of a closed state can be chosen");
  });

  test("3. A second Karnataka application can't be reserved, allocated or activated", async () => {
    // Even a fully paid, agreement-accepted second application can't take the state.
    const ready = await makeApp(await makeUser("readyK"), "Karnataka");
    assert.deepEqual([(await reserve(people.admA, ready.id)).body.code], ["STATE_HELD"]);
    await assert.rejects(activatePartner({ applicationId: ready.id, actorId: people.admA.id }), (e: { extra?: { code?: string } }) => e.extra?.code === "NO_RESERVATION");
    const second = await makeApp(await makeUser("secondK"), "Karnataka", "APPROVED", false);
    const r = await reserve(people.admA, second.id);
    assert.deepEqual([r.status, r.body.code], [409, "STATE_HELD"]);
    await assert.rejects(activatePartner({ applicationId: second.id, actorId: people.admA.id }));
    await assert.rejects(
      prisma.stateAllocation.create({ data: { stateId: st.Karnataka.id, status: "RESERVED", reservedAt: new Date(), applicationId: second.id, createdById: people.admA.id } }),
      (e: { code?: string }) => e.code === "P2002",
      "the database refuses a second holder"
    );
    assert.equal(await prisma.franchisePartner.count({ where: { userId: { in: [people.secondK.id, people.readyK.id] } } }), 0);
  });

  test("4. Maharashtra remains AVAILABLE", async () => {
    assert.equal(await publicAvailability("Maharashtra"), "AVAILABLE");
    assert.equal(await adminStatus("Maharashtra"), "AVAILABLE");
  });

  test("5. Partner B can be activated for Maharashtra", async () => {
    const user = await makeUser("partnerB");
    const app = await makeApp(user, "Maharashtra");
    assert.equal((await reserve(people.admB, app.id)).status, 201);
    const p = await activatePartner({ applicationId: app.id, actorId: people.admB.id });
    fx.partnerB = { user, id: p.id };
    assert.equal(await publicAvailability("Maharashtra"), "CLOSED");
    assert.equal(await publicAvailability("Karnataka"), "CLOSED", "Karnataka unaffected");
  });
});

describe("6: concurrency", () => {
  test("6. simultaneous reservations and activations for one state: exactly one succeeds, the rest roll back", async () => {
    const x = await makeApp(await makeUser("goaX"), "Goa");
    const y = await makeApp(await makeUser("goaY"), "Goa");
    const reserved = await Promise.all([reserve(people.admA, x.id), reserve(people.admB, y.id)]);
    assert.deepEqual(reserved.map((r) => r.status).sort(), [201, 409], JSON.stringify(reserved.map((r) => r.body)));
    const winner = reserved[0].status === 201 ? x : y;
    const loser = winner === x ? y : x;
    const results = await Promise.allSettled([
      activatePartner({ applicationId: winner.id, actorId: people.admA.id }),
      activatePartner({ applicationId: winner.id, actorId: people.admB.id }),
      activatePartner({ applicationId: loser.id, actorId: people.admA.id }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(await prisma.stateAllocation.count({ where: { stateId: st.Goa.id, status: "ALLOCATED" } }), 1);
    assert.equal(await prisma.franchisePartner.count({ where: { applicationId: { in: [x.id, y.id] } } }), 1, "a failed activation leaves no partner");
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: loser.id } })).status, "AGREEMENT_PENDING", "the loser is unchanged");
  });
});

describe("7–9: rejection, withdrawal and suspension never reopen or close a state", () => {
  test("7. a rejected application doesn't close (or hold) its state", async () => {
    const app = await makeApp(await makeUser("keralaRej"), "Kerala", "APPLICATION_SUBMITTED");
    const toReview = await call("POST", `/admin/franchise/applications/${app.id}/transition`, people.admA, { to: "UNDER_REVIEW", expectedVersion: 0 });
    assert.equal(toReview.status, 200, toReview.text);
    assert.equal(await adminStatus("Kerala"), "APPLICATION_UNDER_REVIEW", "an application under review shows, but holds nothing");
    assert.equal(await publicAvailability("Kerala"), "AVAILABLE");
    const rej = await call("POST", `/admin/franchise/applications/${app.id}/transition`, people.admA, { to: "REJECTED", expectedVersion: 1, rejectionReason: "Not a fit for this programme at this time." });
    assert.equal(rej.status, 200, rej.text);
    assert.equal(await publicAvailability("Kerala"), "AVAILABLE");
    assert.equal(await holding("Kerala"), null);
  });

  test("8. a withdrawn application releases its reservation; the state is available again; re-applying is possible", async () => {
    const user = await makeUser("assamW");
    const app = await makeApp(user, "Assam", "APPROVED", false);
    assert.equal((await reserve(people.admA, app.id)).status, 201);
    assert.equal(await publicAvailability("Assam"), "RESERVED");
    assert.equal((await call("POST", "/franchise/applications/me/withdraw", people.student)).status, 409, "someone else has nothing to withdraw");
    const w = await call("POST", "/franchise/applications/me/withdraw", user, { reason: "Changed my plans." });
    assert.equal(w.status, 200, w.text);
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "WITHDRAWN");
    assert.equal(await publicAvailability("Assam"), "AVAILABLE");
    const released = await prisma.stateAllocation.findFirstOrThrow({ where: { applicationId: app.id } });
    assert.deepEqual([released.status, released.releaseReason], ["RELEASED", "Application withdrawn by the applicant"]);
    assert.equal((await call("POST", "/franchise/applications/me/withdraw", user)).status, 409, "nothing left to withdraw");
    const me = await call("GET", "/franchise/applications/me", user);
    assert.deepEqual([me.body.application.status, me.body.application.canWithdraw], ["WITHDRAWN", false]);
  });

  test("9. suspending Partner A keeps Karnataka held (SUSPENDED, not available); it can't be reopened while suspended", async () => {
    const s = await call("POST", `/admin/franchise/partners/${fx.partnerA.id}/suspend`, people.admA, { reason });
    assert.equal(s.status, 200, s.text);
    assert.equal((await holding("Karnataka"))?.status, "SUSPENDED");
    assert.equal(await adminStatus("Karnataka"), "SUSPENDED");
    assert.equal(await publicAvailability("Karnataka"), "CLOSED", "a suspended franchise's state is not offered to others");
    const r = await call("POST", `/admin/franchise/states/${st.Karnataka.id}/reopen-requests`, people.admA, { reason });
    assert.deepEqual([r.status, r.body.code], [409, "FRANCHISE_RIGHTS_ACTIVE"]);
  });
});

describe("10–13: who may change states, and isolation", () => {
  test("10. reopening needs two different admins and a reason; nobody else can do it", async () => {
    const path = `/admin/franchise/states/${st.Karnataka.id}/reopen-requests`;
    for (const who of [people.student, fx.partnerA.user, fx.partnerB.user]) assert.equal((await call("POST", path, who, { reason })).status, 403);
    assert.equal((await call("POST", path, null, { reason })).status, 401);
    // Deactivate Partner A (existing two-admin action); the state stays held until a reopen.
    const dq = await call("POST", `/admin/franchise/partners/${fx.partnerA.id}/requests`, people.admA, { action: "DEACTIVATE", reason });
    assert.equal((await call("POST", `/admin/franchise/partner-requests/${dq.body.request.id}/approve`, people.admB, { expectedPayloadSha: dq.body.request.payloadSha256 })).status, 200);
    assert.equal(await publicAvailability("Karnataka"), "CLOSED", "deactivation alone doesn't reopen the state");
    assert.equal((await call("POST", path, people.admA, { reason: "short" })).status, 400, "a reason is required");
    const req = await call("POST", path, people.admA, { reason });
    assert.equal(req.status, 201, req.text);
    assert.equal((await call("POST", path, people.admB, { reason })).body.code, "REQUEST_EXISTS", "one open request per state");
    const self = await call("POST", `/admin/franchise/state-reopen-requests/${req.body.request.id}/approve`, people.admA, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.deepEqual([self.status, self.body.code], [403, "SAME_ADMIN"]);
    for (const who of [fx.partnerB.user, people.student]) {
      assert.equal((await call("POST", `/admin/franchise/state-reopen-requests/${req.body.request.id}/approve`, who, { expectedPayloadSha: req.body.request.payloadSha256 })).status, 403);
    }
    const bad = await call("POST", `/admin/franchise/state-reopen-requests/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: "0".repeat(64) });
    assert.equal(bad.body.code, "PAYLOAD_MISMATCH");
    const ok = await call("POST", `/admin/franchise/state-reopen-requests/${req.body.request.id}/approve`, people.admB, { expectedPayloadSha: req.body.request.payloadSha256 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(await publicAvailability("Karnataka"), "AVAILABLE");
    assert.equal(await holding("Karnataka"), null);
    const hist = await call("GET", `/admin/franchise/states/${st.Karnataka.id}/history`, people.admA);
    const moves = hist.body.allocations.flatMap((a: { events: { toStatus: string }[] }) => a.events.map((e) => e.toStatus));
    assert.deepEqual(moves, ["RESERVED", "ALLOCATED", "SUSPENDED", "RELEASED"]);
    assert.ok(hist.body.audit.some((a: { action: string }) => a.action === "FRANCHISE_STATE_RELEASED"));
    // Only now can the state be offered again: a waiting applicant can be reserved (then released).
    const second = await prisma.franchiseApplication.findFirstOrThrow({ where: { userId: people.secondK.id } });
    assert.equal((await reserve(people.admB, second.id)).status, 201);
    assert.equal(await adminStatus("Karnataka"), "APPROVED_AWAITING_PAYMENT");
    assert.equal((await call("POST", `/admin/franchise/applications/${second.id}/release-reservation`, people.admB, { reason })).status, 200);
    // With the remaining applicants gone, the admin view shows the state as reopened.
    assert.equal((await call("POST", "/franchise/applications/me/withdraw", people.secondK)).status, 200);
    await prisma.franchiseApplication.update({ where: { id: (await prisma.franchiseApplication.findFirstOrThrow({ where: { userId: people.readyK.id } })).id }, data: { status: "REJECTED", rejectionReason: "test", rejectedAt: new Date() } }); // fixture shortcut
    assert.equal(await adminStatus("Karnataka"), "REOPENED_AVAILABLE");
    assert.equal(await adminStatus("Assam"), "AVAILABLE", "an ended reservation is not a reopening");
  });

  test("the database itself refuses to delete an allocation or to undo a release", async () => {
    const released = await prisma.stateAllocation.findFirstOrThrow({ where: { stateId: st.Karnataka.id, status: "RELEASED", partnerId: fx.partnerA.id } });
    await assert.rejects(prisma.stateAllocation.delete({ where: { id: released.id } }), /never deleted/);
    await assert.rejects(prisma.stateAllocation.update({ where: { id: released.id }, data: { status: "ALLOCATED", allocatedAt: new Date() } }), /not allowed/);
    await assert.rejects(prisma.stateAllocation.update({ where: { id: released.id }, data: { stateId: st.Bihar.id } }), /can't change/);
    const ev = await prisma.stateAllocationEvent.findFirstOrThrow({ where: { allocationId: released.id } });
    await assert.rejects(prisma.stateAllocationEvent.delete({ where: { id: ev.id } }), /append-only/);
  });

  test("11. partners can't reserve, release or reopen a state, nor change student ownership", async () => {
    const app = await makeApp(await makeUser("biharApp"), "Bihar", "APPROVED", false);
    const pb = fx.partnerB.user;
    for (const [method, path, body] of [
      ["POST", `/admin/franchise/applications/${app.id}/reserve-state`, { reason, days: 30 }],
      ["POST", `/admin/franchise/applications/${app.id}/release-reservation`, { reason }],
      ["POST", `/admin/franchise/states/${st.Bihar.id}/reopen-requests`, { reason }],
      ["POST", `/admin/franchise/partners/${fx.partnerA.id}/suspend`, { reason }],
    ] as const) {
      assert.equal((await call(method, path, pb, body)).status, 403, path);
    }
    for (const path of ["/franchise-partner/state", "/franchise-partner/students/transfer", "/franchise-partner/state/reopen"]) {
      assert.equal((await call("POST", path, pb, { stateId: st.Bihar.id })).status, 404, `${path} doesn't exist`);
    }
    assert.equal(await holding("Bihar"), null, "nothing changed");
  });

  test("12. partners can't use any admin state, application or partner API", async () => {
    for (const path of ["/admin/franchise/states", `/admin/franchise/states/${st.Maharashtra.id}/history`, "/admin/franchise/state-reopen-requests", "/admin/franchise/applications", "/admin/franchise/partners"]) {
      assert.equal((await call("GET", path, fx.partnerB.user)).status, 403, path);
    }
  });

  test("13. Partner B's dashboard never shows another partner's students, and A (deactivated) is shut out", async () => {
    const studentOfA = await makeUser("studentOfA");
    await linkFixture(prisma, { partnerId: fx.partnerA.id, studentUserId: studentOfA.id, status: "ACTIVE", source: "TEST", createdById: studentOfA.id });
    for (const view of ["/franchise-partner/students", "/franchise-partner/enrolments", "/franchise-partner/progress"]) {
      const r = await call("GET", `${view}?partnerId=${fx.partnerA.id}&stateId=${st.Karnataka.id}`, fx.partnerB.user);
      assert.equal(r.status, 200, r.text);
      assert.doesNotMatch(r.text, /studentOfA/);
    }
    assert.equal((await call("GET", "/franchise-partner/earnings", fx.partnerB.user)).body.earnings.available, false);
    assert.equal((await call("GET", "/franchise-partner/overview", fx.partnerA.user)).status, 403, "a deactivated partner has no dashboard");
  });
});

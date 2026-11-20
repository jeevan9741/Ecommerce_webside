/**
 * Withdrawing a franchise application: the applicant gets a confirmation email; an approved application is
 * given up only with an explicit confirmation, and then the admin inbox is told (nothing personal). Emails
 * are captured (never sent). Applications are seeded directly; everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
process.env.FRANCHISE_PUBLIC_ENABLED = "true";
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

const realEmail = await import("../src/services/email.service.js");
const sent: { to: string; subject: string; html: string }[] = [];
let failEmailsTo: string | null = null;
mock.module("../src/services/email.service.js", {
  namedExports: {
    ...realEmail,
    sendEmail: async (m: { to: string; subject: string; html: string }) => {
      if (failEmailsTo && m.to === failEmailsTo) throw new Error("simulated provider outage");
      sent.push(m);
    },
  },
});

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken } = await import("../src/utils/tokens.js");
const { flushAdminNotifications } = await import("../src/services/admin-notify.service.js");

const ADMIN_INBOX = "zz-admin-inbox@example.test";
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
let admin: U;
let seq = 0;

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER"): Promise<U> {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `W${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  return { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

/** An application in its own fresh state (one franchise per state), in the given status. */
async function makeApp(status: "APPLICATION_SUBMITTED" | "APPROVED" | "AGREEMENT_PENDING") {
  const n = ++seq;
  const applicant = await makeUser(`w${n}`);
  const st = await prisma.indiaState.create({ data: { name: `${tag} State ${n}`, isActive: true } });
  const d = await prisma.district.create({ data: { stateId: st.id, name: `${tag} d${n}`, isActive: true } });
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZZ-${short}-${String(n).padStart(4, "0")}`,
      userId: applicant.id,
      applicantName: `Applicant ${n}`,
      mobile: `9${String(830000000 + n)}`,
      email: applicant.email,
      stateId: st.id,
      districtId: d.id,
      address: `${n}, Secret Lane`,
      pincode: "560034",
      status,
      ...(status !== "APPLICATION_SUBMITTED" ? { approvedAt: new Date(), approvedById: admin.id } : {}),
      requiredDocumentKinds: ["ID_PROOF"],
      history: { create: { toStatus: "APPLICATION_SUBMITTED", actorId: applicant.id, actorType: "APPLICANT", applicantNote: "Application submitted" } },
    },
  });
  return { app, applicant, stateName: st.name };
}

async function call(method: string, path: string, user: { token: string } | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.44.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const withdraw = (u: U, body: unknown = {}) => call("POST", "/franchise/applications/me/withdraw", u, body);
const reserve = (appId: string) => call("POST", `/admin/franchise/applications/${appId}/reserve-state`, admin, { reason: "Holding while the fee is arranged", days: 30 });
const toApplicant = (u: U) => sent.filter((m) => m.to === u.email);
const toAdmins = () => sent.filter((m) => m.to === ADMIN_INBOX);

before(async () => {
  process.env.ADMIN_NOTIFY_EMAIL = ADMIN_INBOX;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await makeUser("adm", "ADMIN");
});

after(async () => {
  delete process.env.ADMIN_NOTIFY_EMAIL;
  await flushAdminNotifications();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-withdrawal test cleanup'`;
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: apps } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("withdrawal before approval", () => {
  test("the applicant gets one confirmation email (sign-in link, apply-again note); no admin email; recorded", async () => {
    const { app, applicant } = await makeApp("APPLICATION_SUBMITTED");
    sent.length = 0;
    const me = await call("GET", "/franchise/applications/me", applicant);
    assert.equal(me.body.application.withdrawNeedsConfirmation, false);
    const r = await withdraw(applicant);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await flushAdminNotifications();
    const mail = toApplicant(applicant);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].subject, `Your franchise application ${app.applicationNo} has been withdrawn`);
    assert.match(mail[0].html, /Nothing more will happen with it/);
    assert.match(mail[0].html, /apply again at any time/);
    assert.match(mail[0].html, /\/franchise\/apply/);
    assert.match(mail[0].html, /\/franchise\/application"/);
    assert.equal(mail[0].html.includes("approved"), false, "no approval wording for an unapproved application");
    assert.equal(toAdmins().length, 0, "ordinary withdrawals don't email the admin inbox");
    const n = await prisma.franchiseNotification.findFirstOrThrow({ where: { applicationId: app.id, kind: "APPLICATION_WITHDRAWN" } });
    assert.equal(n.status, "SENT");
  });

  test("an email failure doesn't undo the withdrawal; the record says FAILED", async () => {
    const { app, applicant } = await makeApp("APPLICATION_SUBMITTED");
    failEmailsTo = applicant.email;
    try {
      assert.equal((await withdraw(applicant)).status, 200);
    } finally {
      failEmailsTo = null;
    }
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "WITHDRAWN");
    assert.equal((await prisma.franchiseNotification.findFirstOrThrow({ where: { applicationId: app.id, kind: "APPLICATION_WITHDRAWN" } })).status, "FAILED");
  });
});

describe("withdrawal after approval", () => {
  test("refused without confirmApproved: nothing changes, no emails", async () => {
    const { app, applicant } = await makeApp("APPROVED");
    assert.equal((await reserve(app.id)).status, 201);
    sent.length = 0;
    const me = await call("GET", "/franchise/applications/me", applicant);
    assert.equal(me.body.application.withdrawNeedsConfirmation, true);
    for (const body of [{}, { confirmApproved: false }, { reason: "Changed my plans" }]) {
      const r = await withdraw(applicant, body);
      assert.deepEqual([r.status, r.body.code], [409, "CONFIRMATION_REQUIRED"], JSON.stringify(body));
    }
    assert.equal((await withdraw(applicant, { confirmApproved: "yes" })).status, 400, "only a real true counts");
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "APPROVED");
    assert.equal((await prisma.stateAllocation.findFirstOrThrow({ where: { applicationId: app.id } })).status, "RESERVED");
    await flushAdminNotifications();
    assert.equal(sent.length, 0);
  });

  test("with confirmation: withdrawn, reservation released, applicant told the approval ended, one admin email with nothing personal", async () => {
    const { app, applicant, stateName } = await makeApp("APPROVED");
    assert.equal((await reserve(app.id)).status, 201);
    sent.length = 0;
    const r = await withdraw(applicant, { confirmApproved: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "WITHDRAWN");
    assert.equal((await prisma.stateAllocation.findFirstOrThrow({ where: { applicationId: app.id } })).status, "RELEASED");
    const locs = (await call("GET", "/franchise/locations", null)).body.states as { name: string; availability: string }[];
    assert.equal(locs.find((s) => s.name === stateName)?.availability, "AVAILABLE", "the state is open again");

    const mine = toApplicant(applicant);
    assert.equal(mine.length, 1);
    assert.match(mine[0].html, /had been approved\. The approval and the state reservation ended/);

    await flushAdminNotifications();
    const adminMail = toAdmins();
    assert.equal(adminMail.length, 1);
    assert.equal(adminMail[0].subject, `[ETA admin] Approved application withdrawn — ${app.applicationNo}`);
    assert.match(adminMail[0].html, /Released — the state is open to applicants again/);
    assert.match(adminMail[0].html, new RegExp(stateName));
    for (const secret of [app.mobile, "Secret Lane", "560034", applicant.email]) assert.equal(adminMail[0].html.includes(secret), false, `admin email must not contain ${secret}`);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_APPLICATION_WITHDRAWN", target: app.id } });
    assert.deepEqual([(audit.metadata as { fromStatus: string }).fromStatus, (audit.metadata as { reservationReleased: boolean }).reservationReleased], ["APPROVED", true]);

    // Nothing left to withdraw; no more emails.
    sent.length = 0;
    assert.deepEqual([(await withdraw(applicant, { confirmApproved: true })).body.code], ["NOTHING_TO_WITHDRAW"]);
    await flushAdminNotifications();
    assert.equal(sent.length, 0);
  });

  test("approved without a reservation: the admin email says so", async () => {
    const { applicant } = await makeApp("APPROVED");
    sent.length = 0;
    assert.equal((await withdraw(applicant, { confirmApproved: true })).status, 200);
    await flushAdminNotifications();
    const adminMail = toAdmins();
    assert.equal(adminMail.length, 1);
    assert.match(adminMail[0].html, /State reservation<\/td><td[^>]*>None/);
    assert.match(toApplicant(applicant)[0].html, /The approval ended with the withdrawal/);
  });

  test("agreement pending still can't be withdrawn by the applicant", async () => {
    const { app, applicant } = await makeApp("AGREEMENT_PENDING");
    const r = await withdraw(applicant, { confirmApproved: true });
    assert.deepEqual([r.status, r.body.code], [409, "NOTHING_TO_WITHDRAW"]);
    assert.equal((await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: app.id } })).status, "AGREEMENT_PENDING");
  });
});

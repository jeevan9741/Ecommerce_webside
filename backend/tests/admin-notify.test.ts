/**
 * Admin notification emails (ADMIN_NOTIFY_EMAIL): which events send one, exactly once, with only
 * non-sensitive details, never breaking the action that caused them; plus the admin status/test
 * endpoints. Emails are captured (never sent). Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
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
const { markOrderPaid, reverseOrder } = await import("../src/services/order.service.js");
const { markRequestPaid } = await import("../src/services/partner-card.service.js");
const { flushAdminNotifications, adminEmail } = await import("../src/services/admin-notify.service.js");
const { adminNotifyRecipients, adminNotifyStatusLine } = await import("../src/utils/admin-notify-config.js");

const ADMIN_INBOX = "zz-admin-inbox@example.test";
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const userIds: string[] = [];
const courseIds: string[] = [];
const jobIds: string[] = [];
type U = { id: string; token: string; email: string; name: string };

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER"): Promise<U> {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `N${tag.slice(-8)}${userIds.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  return { id: u.id, email: u.email, name, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

async function call(method: string, path: string, user: U | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const adminMails = () => sent.filter((m) => m.to === ADMIN_INBOX);
async function settle() {
  await flushAdminNotifications();
}
/** The customer's receipt is sent in the background (not tracked by the admin flush). */
async function receiptTo(email: string) {
  for (let i = 0; i < 40 && !sent.some((m) => m.to === email); i++) await new Promise((r) => setTimeout(r, 50));
  return sent.filter((m) => m.to === email).length;
}

let courseId = "";
async function paidOrder(user: U, paymentId = `pay_${tag}${randomBytes(4).toString("hex")}`) {
  const razorpayOrderId = `order_${tag}${randomBytes(4).toString("hex")}`;
  const order = await prisma.order.create({ data: { userId: user.id, courseId, amountInPaise: 99900, status: "CREATED", razorpayOrderId } });
  const facts = { id: paymentId, orderId: razorpayOrderId, amountInPaise: 99900, currency: "INR", status: "captured" as const };
  return { order, facts, pay: () => markOrderPaid({ razorpayOrderId, payment: facts }) };
}

before(async () => {
  process.env.ADMIN_NOTIFY_EMAIL = ADMIN_INBOX;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const course = await prisma.course.create({
    data: { slug: `${tag}-course`, type: "VIDEO", title: `${tag} Course <Pro>`, shortDescription: "x", description: "x", priceInPaise: 99900, commissionInPaise: 20000, isActive: true },
  });
  courseId = course.id;
  courseIds.push(course.id);
});

after(async () => {
  delete process.env.ADMIN_NOTIFY_EMAIL;
  await flushAdminNotifications();
  const where = { userId: { in: userIds } };
  await prisma.partnerCardRequest.deleteMany({ where });
  await prisma.partnerCard.deleteMany({ where });
  await prisma.withdrawalRequest.deleteMany({ where: { partnerId: { in: userIds } } });
  await prisma.payoutMethod.deleteMany({ where });
  await prisma.referralClaim.deleteMany({ where: { partnerId: { in: userIds } } });
  await prisma.commissionLedger.deleteMany({ where: { partnerId: { in: userIds } } });
  await prisma.courseAccess.deleteMany({ where });
  await prisma.order.deleteMany({ where });
  await prisma.jobApplication.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobPosting.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: userIds } }] } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await new Promise((r) => server.close(r));
});

describe("configuration", () => {
  test("ADMIN_NOTIFY_EMAIL: one address or a comma-separated list; invalid parts ignored; deduplicated; masked in the log", () => {
    assert.deepEqual(adminNotifyRecipients("ecommercetrainingacademyeta@gmail.com"), ["ecommercetrainingacademyeta@gmail.com"]);
    assert.deepEqual(adminNotifyRecipients(" A@x.test , b@y.test,a@X.TEST, not-an-email, ,c@z"), ["a@x.test", "b@y.test"]);
    assert.deepEqual(adminNotifyRecipients(""), []);
    assert.equal(adminNotifyStatusLine("ecommercetrainingacademyeta@gmail.com"), "[EMAIL] admin notifications: on → ec***@gmail.com");
    assert.equal(adminNotifyStatusLine(""), "[EMAIL] admin notifications: off");
    assert.match(adminNotifyStatusLine("nonsense"), /off \(ADMIN_NOTIFY_EMAIL has no valid address\)/);
  });

  test("every value is HTML-escaped and the subject is prefixed", () => {
    const m = adminEmail({ kind: "JOB_APPLICATION", applicationId: "x", jobTitle: "<b>Ops</b>", applicantName: `<script>alert(1)</script>`, hasResume: false });
    assert.match(m.subject, /^\[ETA admin\] /);
    assert.doesNotMatch(m.html, /<script>|<b>Ops<\/b>/);
    assert.match(m.html, /&lt;script&gt;/);
  });
});

describe("course payment and refund", () => {
  test("payment: exactly one admin email even when the webhook and the checkout race; no customer email address", async () => {
    const buyer = await makeUser("buyer");
    sent.length = 0;
    const { order, pay } = await paidOrder(buyer);
    const results = await Promise.all([pay(), pay(), pay()]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    await settle();
    const mails = adminMails();
    assert.equal(mails.length, 1, JSON.stringify(mails.map((m) => m.subject)));
    assert.match(mails[0].subject, /^\[ETA admin\] Payment received ₹999 — /);
    assert.match(mails[0].html, /buyer/);
    assert.match(mails[0].html, /\/admin\/orders/);
    assert.doesNotMatch(mails[0].html, new RegExp(buyer.email.replace(/[.+]/g, "\\$&")), "no customer email address");
    assert.equal(await receiptTo(buyer.email), 1, "the customer's own receipt is still sent once");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
  });

  test("refund: one admin email per refunded payment, even when two refunds race", async () => {
    const buyer = await makeUser("refunded");
    const { facts, pay } = await paidOrder(buyer);
    await pay();
    await settle();
    sent.length = 0;
    const results = await Promise.all([reverseOrder(facts.id, "refund_processed"), reverseOrder(facts.id, "refund_processed")]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    await settle();
    assert.equal(adminMails().length, 1);
    assert.match(adminMails()[0].subject, /Refund processed ₹999/);
  });

  test("an email outage never affects the payment", async () => {
    const buyer = await makeUser("outage");
    failEmailsTo = ADMIN_INBOX;
    try {
      const { order, pay } = await paidOrder(buyer);
      const r = await pay();
      assert.equal(r.ok, true);
      await settle();
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
    } finally {
      failEmailsTo = null;
    }
  });

  test("with ADMIN_NOTIFY_EMAIL unset, no admin email is sent and the payment works", async () => {
    const buyer = await makeUser("quiet");
    delete process.env.ADMIN_NOTIFY_EMAIL;
    try {
      sent.length = 0;
      const { pay } = await paidOrder(buyer);
      assert.equal((await pay()).ok, true);
      await settle();
      assert.equal(await receiptTo(buyer.email), 1, "the receipt still goes out");
      assert.equal(adminMails().length, 0);
    } finally {
      process.env.ADMIN_NOTIFY_EMAIL = ADMIN_INBOX;
    }
  });
});

describe("requests that need an admin", () => {
  test("withdrawal request: amount and name, never the payout details", async () => {
    const partner = await makeUser("payee");
    const { order, pay } = await paidOrder(partner);
    await pay();
    await prisma.commissionLedger.create({ data: { partnerId: partner.id, orderId: order.id, amountInPaise: 50000, status: "CREDITED" } });
    const method = await prisma.payoutMethod.create({ data: { userId: partner.id, type: "UPI", encryptedDetails: "zz-encrypted-secret", label: "UPI zzpayee@okbank" } });
    await settle();
    sent.length = 0;
    const r = await call("POST", "/withdrawals", partner, { payoutMethodId: method.id, amountInPaise: 15000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await settle();
    assert.equal(adminMails().length, 1);
    const m = adminMails()[0];
    assert.match(m.subject, /Withdrawal request ₹150/);
    assert.match(m.html, /payee/);
    for (const secret of ["zzpayee@okbank", "zz-encrypted-secret", "UPI zz"]) assert.equal(m.html.includes(secret), false, `must not contain ${secret}`);
  });

  test("referral claim: partner and package, never the student's name, phone or the UTR", async () => {
    const partner = await makeUser("claimer");
    sent.length = 0;
    const utr = `ZZ${randomBytes(6).toString("hex").toUpperCase()}`;
    const r = await call("POST", "/referral-claims", partner, { studentName: "Zz Student Person", studentPhone: "9123400099", courseId, utr });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await settle();
    assert.equal(adminMails().length, 1);
    const m = adminMails()[0];
    assert.match(m.html, /claimer/);
    assert.match(m.html, /\/admin\/referral-claims/);
    for (const secret of ["Zz Student Person", "9123400099", utr]) assert.equal(m.html.includes(secret), false, `must not contain ${secret}`);
  });

  test("job application: position and applicant name, never their email, phone or a résumé link", async () => {
    const job = await prisma.jobPosting.create({ data: { title: `${tag} Trainer`, description: "x", eligibility: "x", salary: "x", workType: "OFFICE", workingHours: "x", isActive: true } });
    jobIds.push(job.id);
    sent.length = 0;
    const r = await call("POST", `/jobs/${job.id}/apply`, null, { applicantName: "Zz Job Seeker", email: "zz-seeker@example.test", phone: "9123400088" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await settle();
    assert.equal(adminMails().length, 1);
    const m = adminMails()[0];
    assert.match(m.html, /Zz Job Seeker/);
    for (const secret of ["zz-seeker@example.test", "9123400088", "resumes/"]) assert.equal(m.html.includes(secret), false, `must not contain ${secret}`);
  });

  test("partner ID card reissue fee paid: one admin email when the webhook and the checkout race", async () => {
    const partner = await makeUser("cardholder");
    const card = await prisma.partnerCard.create({ data: { userId: partner.id, partnerId: `ZZ${randomBytes(4).toString("hex")}`, fullName: "Zz Card Holder", location: "x", email: partner.email, phone: "9123400077", qrToken: `zz${randomBytes(6).toString("hex")}`, qrCodeUrl: "x", status: "ACTIVE" } });
    const razorpayOrderId = `order_${tag}card${randomBytes(3).toString("hex")}`;
    await prisma.partnerCardRequest.create({ data: { cardId: card.id, userId: partner.id, kind: "REISSUE", status: "AWAITING_PAYMENT", paymentStatus: "PENDING", feeInPaise: 9900, razorpayOrderId, fullName: "Zz Card Holder", location: "x", phone: "9123400077" } });
    sent.length = 0;
    const payment = { id: `pay_${tag}card`, orderId: razorpayOrderId, amountInPaise: 9900, currency: "INR", status: "captured" as const };
    const results = await Promise.all([markRequestPaid({ razorpayOrderId, payment }), markRequestPaid({ razorpayOrderId, payment })]);
    assert.ok(results.every((x) => x.ok), JSON.stringify(results));
    await settle();
    assert.equal(adminMails().length, 1);
    assert.match(adminMails()[0].subject, /Partner ID card reissue fee paid/);
    assert.equal(adminMails()[0].html.includes("9123400077"), false);
  });
});

describe("admin status and test endpoints", () => {
  test("only admins; status shows masked recipients; a test email is sent and audited", async () => {
    const student = await makeUser("nosy");
    const admin = await makeUser("notifier", "ADMIN");
    assert.equal((await call("GET", "/admin/notifications/status", null)).status, 401);
    assert.equal((await call("POST", "/admin/notifications/test", student)).status, 403);
    const s = await call("GET", "/admin/notifications/status", admin);
    assert.deepEqual(s.body, { enabled: true, recipients: ["zz***@example.test"] });
    sent.length = 0;
    const t = await call("POST", "/admin/notifications/test", admin);
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.deepEqual([t.body.sent, t.body.recipients], [1, ["zz***@example.test"]]);
    assert.equal(adminMails().length, 1);
    assert.match(adminMails()[0].subject, /\[ETA admin\] Test notification/);
    assert.equal(await prisma.auditLog.count({ where: { actorId: admin.id, action: "ADMIN_NOTIFICATION_TEST_SENT" } }), 1);
  });

  test("with ADMIN_NOTIFY_EMAIL unset the status is off and a test is refused", async () => {
    const admin = await makeUser("notifier2", "ADMIN");
    delete process.env.ADMIN_NOTIFY_EMAIL;
    try {
      assert.deepEqual((await call("GET", "/admin/notifications/status", admin)).body, { enabled: false, recipients: [] });
      const t = await call("POST", "/admin/notifications/test", admin);
      assert.deepEqual([t.status, t.body.code], [409, "ADMIN_NOTIFY_NOT_CONFIGURED"]);
    } finally {
      process.env.ADMIN_NOTIFY_EMAIL = ADMIN_INBOX;
    }
  });
});

/**
 * "Request more info / documents" on franchise applications, through the real HTTP API: an admin asks,
 * the applicant replies once with files and/or text, re-uploads keep the earlier files, emails go to the
 * applicant and the admin inbox (captured, never sent), every step is audited, and the database guards
 * the request record. Storage is an in-memory stand-in. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
process.env.FRANCHISE_PUBLIC_ENABLED = "true";
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

const store = new Map<string, Buffer>();
let failUploadAfter = Infinity;
let uploads = 0;
mock.module("../src/services/storage.service.js", {
  namedExports: {
    publicStoreConfigured: () => false,
    getUploadUrl: async (key: string) => ({ url: `https://blob.invalid/upload/${key}`, key }),
    getDownloadUrl: async (key: string, seconds = 300) => `https://blob.invalid/${key}?expires=${seconds}`,
    uploadBuffer: async (key: string, body: Buffer, _type: string, options?: { allowOverwrite?: boolean }) => {
      uploads += 1;
      if (uploads >= failUploadAfter) throw new Error("simulated storage outage");
      if (options?.allowOverwrite === false && store.has(key)) throw new Error("exists");
      store.set(key, body);
      return { url: `https://blob.invalid/${key}`, pathname: key };
    },
    deleteObject: async (key: string) => {
      store.delete(key);
    },
    buildStorageKey: (prefix: string, filename: string) => `${prefix}/${filename}`,
    getClientUploadToken: async () => "test-token",
    readObjectHead: async () => Buffer.alloc(0),
    statObject: async () => null,
  },
});
const realEmail = await import("../src/services/email.service.js");
const sent: { to: string; subject: string; html: string }[] = [];
mock.module("../src/services/email.service.js", {
  namedExports: { ...realEmail, sendEmail: async (m: { to: string; subject: string; html: string }) => void sent.push(m) },
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
let stateId = "";
let districtId = "";
let seq = 0;

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER"): Promise<U> {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `Q${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  return { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

/** A submitted application with an ID proof on file, for a fresh applicant (or the given user). */
async function makeApp(user?: U, status: "APPLICATION_SUBMITTED" | "UNDER_REVIEW" | "APPROVED" = "APPLICATION_SUBMITTED") {
  const n = ++seq;
  const applicant = user ?? (await makeUser(`app${n}`));
  const app = await prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZZ-${short}-${String(n).padStart(4, "0")}`,
      userId: applicant.id,
      applicantName: `Applicant ${n}`,
      mobile: `9${String(820000000 + n)}`,
      email: applicant.email,
      stateId,
      districtId,
      address: `${n}, Secret Lane`,
      pincode: "560034",
      status,
      requiredDocumentKinds: ["ID_PROOF"],
      history: { create: { toStatus: "APPLICATION_SUBMITTED", actorId: applicant.id, actorType: "APPLICANT", applicantNote: "Application submitted" } },
      documents: { create: { kind: "ID_PROOF", storageKey: `franchise-applications/zz-${tag}-${n}/id_proof-old.pdf`, originalName: "old-id.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "c".repeat(64), uploadedById: applicant.id } },
    },
  });
  return { app, applicant };
}

const ip = () => `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(method: string, path: string, user: { token: string } | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": ip(), ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const PDF = (s = "") => Buffer.from(`%PDF-1.4\n% ${tag} ${s} ${randomBytes(4).toString("hex")}\n%%EOF\n`);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(32)]);
type Part = { field: string; body: Buffer; type: string; name?: string };
async function reply(user: U, requestId: string, parts: Part[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const p of parts) form.append(p.field, new Blob([new Uint8Array(p.body)], { type: p.type }), p.name ?? `${p.field}.${p.type.split("/")[1]}`);
  const res = await fetch(`${base}/api/franchise/applications/me/document-requests/${requestId}/reply`, { method: "POST", headers: { "X-Forwarded-For": ip(), Authorization: `Bearer ${user.token}` }, body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const ask = (appId: string, body: unknown, who: { token: string } | null = admin) => call("POST", `/admin/franchise/applications/${appId}/document-requests`, who, body);
const audits = (appId: string, action: string) => prisma.auditLog.findMany({ where: { target: appId, action }, orderBy: { createdAt: "asc" } });

before(async () => {
  process.env.ADMIN_NOTIFY_EMAIL = ADMIN_INBOX;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await makeUser("adm", "ADMIN");
  const st = await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } });
  stateId = st.id;
  districtId = (await prisma.district.create({ data: { stateId: st.id, name: `${tag} d1`, isActive: true } })).id;
});

after(async () => {
  delete process.env.ADMIN_NOTIFY_EMAIL;
  await flushAdminNotifications();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-document-request test cleanup'`;
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      await tx.franchiseApplicationDocument.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseDocumentRequest.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...apps, ...userIds] } }] } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("admin asks for more information", () => {
  test("only admins can ask; the message and kinds are validated; never on one's own application", async () => {
    const { app, applicant } = await makeApp();
    assert.equal((await ask(app.id, { kinds: ["PHOTO"], message: "Please send a photo." }, null)).status, 401);
    assert.equal((await ask(app.id, { kinds: ["PHOTO"], message: "Please send a photo." }, applicant)).status, 403);
    const short_ = await ask(app.id, { kinds: ["PHOTO"], message: "Photo pls" });
    assert.deepEqual([short_.status, short_.body.code], [400, "INVALID_REQUEST"]);
    assert.equal((await ask(app.id, { kinds: ["PASSPORT"], message: "Please send a passport." })).status, 400);
    const own = await makeApp(admin);
    const self = await ask(own.app.id, { kinds: ["PHOTO"], message: "Please send a photograph." });
    assert.deepEqual([self.status, self.body.code], [403, "SELF_REVIEW"]);
    assert.equal(await prisma.franchiseDocumentRequest.count({ where: { applicationId: { in: [app.id, own.app.id] } } }), 0);
  });

  test("not after a decision, and only one open request at a time", async () => {
    const approved = await makeApp(undefined, "APPROVED");
    const r = await ask(approved.app.id, { kinds: ["PHOTO"], message: "Please send a photograph." });
    assert.deepEqual([r.status, r.body.code], [409, "NOT_REQUESTABLE"]);
    const { app } = await makeApp(undefined, "UNDER_REVIEW");
    assert.equal((await ask(app.id, { kinds: ["PHOTO"], message: "Please send a photograph." })).status, 201);
    const again = await ask(app.id, { kinds: ["ADDRESS_PROOF"], message: "Please send address proof." });
    assert.deepEqual([again.status, again.body.code], [409, "REQUEST_OPEN"]);
  });

  test("the applicant is emailed the document names (not the message) and sees the request after sign-in; audited without the text", async () => {
    const { app, applicant } = await makeApp();
    sent.length = 0;
    const message = "Your address proof is blurred, please upload a clearer copy.";
    const r = await ask(app.id, { kinds: ["ADDRESS_PROOF", "ADDITIONAL", "ADDRESS_PROOF"], message });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.kinds, ["ADDRESS_PROOF", "ADDITIONAL"], "duplicates removed");
    const mail = sent.filter((m) => m.to === applicant.email);
    assert.equal(mail.length, 1);
    assert.match(mail[0].subject, /More information needed for your franchise application ZZ-/);
    assert.match(mail[0].html, /Address proof, Other document/);
    assert.equal(mail[0].html.includes("blurred"), false, "the message stays behind sign-in");
    const me = await call("GET", "/franchise/applications/me", applicant);
    assert.equal(me.body.application.documentRequests[0].message, message);
    assert.equal(me.body.application.documentRequests[0].status, "OPEN");
    const [a] = await audits(app.id, "FRANCHISE_DOCUMENTS_REQUESTED");
    assert.equal(JSON.stringify(a.metadata).includes("blurred"), false);
    assert.equal((await prisma.franchiseNotification.findFirstOrThrow({ where: { applicationId: app.id } })).kind, "DOCUMENTS_REQUESTED");
    const detail = await call("GET", `/admin/franchise/applications/${app.id}`, admin);
    assert.equal(detail.body.application.canRequestInfo, false);
    assert.equal(detail.body.application.documentRequests[0].requestedBy, "adm");
  });
});

describe("applicant replies", () => {
  test("requested files are required, unrequested ones refused, and file rules apply; someone else's request isn't found", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: ["ID_PROOF", "PHOTO"], message: "Please send a new ID proof and a photograph." })).body;
    const missing = await reply(applicant, req.id, [{ field: "idProof", body: PDF(), type: "application/pdf" }]);
    assert.deepEqual([missing.status, missing.body.code], [400, "DOCUMENT_REQUIRED"]);
    const extra = await reply(applicant, req.id, [{ field: "idProof", body: PDF(), type: "application/pdf" }, { field: "photo", body: PNG(), type: "image/png" }, { field: "addressProof", body: PNG(), type: "image/png" }]);
    assert.deepEqual([extra.status, extra.body.code], [400, "UNEXPECTED_FILE"]);
    const wrong = await reply(applicant, req.id, [{ field: "idProof", body: Buffer.from("plain text"), type: "application/pdf" }, { field: "photo", body: PNG(), type: "image/png" }]);
    assert.deepEqual([wrong.status, wrong.body.code], [415, "UNSUPPORTED_FILE"]);
    const big = await reply(applicant, req.id, [{ field: "idProof", body: Buffer.concat([PDF(), Buffer.alloc(5 * 1024 * 1024)]), type: "application/pdf" }, { field: "photo", body: PNG(), type: "image/png" }]);
    assert.deepEqual([big.status, big.body.code], [413, "FILE_TOO_LARGE"]);
    const stranger = await makeUser(`stranger${seq}`);
    assert.equal((await reply(stranger, req.id, [{ field: "idProof", body: PDF(), type: "application/pdf" }, { field: "photo", body: PNG(), type: "image/png" }])).status, 404);
    assert.equal((await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "OPEN", "nothing changed");
    assert.equal(await prisma.franchiseApplicationDocument.count({ where: { applicationId: app.id } }), 1);
  });

  test("a reply replaces the current file but keeps the earlier one; confirmation and admin emails carry no personal data", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: ["ID_PROOF", "ADDITIONAL"], message: "Please send a clearer ID proof and any licence." })).body;
    sent.length = 0;
    const r = await reply(
      applicant,
      req.id,
      [
        { field: "idProof", body: PDF("new id"), type: "application/pdf", name: "new-id.pdf" },
        { field: "additional", body: PDF("licence"), type: "application/pdf", name: "licence.pdf" },
        { field: "additional", body: PNG(), type: "image/png", name: "shop.png" },
      ],
      { responseText: "Here are the documents. My shop licence number is SECRET-LIC-42." },
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.files, 3);
    const docs = await prisma.franchiseApplicationDocument.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(docs.map((d) => [d.kind, d.documentRequestId === req.id]), [["ID_PROOF", false], ["ID_PROOF", true], ["ADDITIONAL", true], ["ADDITIONAL", true]], "the earlier ID proof is kept");
    const row = await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: req.id } });
    assert.equal(row.status, "FULFILLED");
    assert.ok(row.fulfilledAt);
    assert.match(row.responseText ?? "", /SECRET-LIC-42/);
    // Applicant confirmation.
    const confirm = sent.filter((m) => m.to === applicant.email);
    assert.equal(confirm.length, 1);
    assert.match(confirm[0].subject, /We received your reply/);
    // Admin inbox: who and what kinds, nothing personal.
    await flushAdminNotifications();
    const adminMail = sent.filter((m) => m.to === ADMIN_INBOX);
    assert.equal(adminMail.length, 1);
    assert.match(adminMail[0].subject, /^\[ETA admin\] Reply received — ZZ-/);
    assert.match(adminMail[0].html, /3 \(ID proof, Other document\)/);
    for (const secret of ["SECRET-LIC-42", "Secret Lane", "560034", applicant.email, "blob.invalid", app.mobile, ...docs.map((d) => d.storageKey)]) {
      assert.equal(adminMail[0].html.includes(secret), false, `admin email must not contain ${secret}`);
    }
    const [audit] = await audits(app.id, "FRANCHISE_DOCUMENTS_SUBMITTED");
    assert.equal(JSON.stringify(audit.metadata).includes("SECRET"), false);
    assert.equal((audit.metadata as { files: number }).files, 3);
    // Second reply refused; the admin page shows both versions and the reply.
    const again = await reply(applicant, req.id, [{ field: "idProof", body: PDF(), type: "application/pdf" }, { field: "additional", body: PDF(), type: "application/pdf" }]);
    assert.deepEqual([again.status, again.body.code], [409, "NOT_OPEN"]);
    const detail = (await call("GET", `/admin/franchise/applications/${app.id}`, admin)).body.application;
    assert.equal(detail.documents.length, 4);
    assert.equal(detail.documentRequests[0].responseText, row.responseText);
    assert.equal(detail.canRequestInfo, true, "a new request can be made after a reply");
    for (const d of docs) assert.equal((await call("POST", `/admin/franchise/applications/${app.id}/documents/${d.id}/url`, admin)).status, 200, "every version can be viewed");
  });

  test("a message-only request needs a written reply; more than 3 other documents are refused", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: [], message: "When can you visit our office for a discussion?" })).body;
    const empty = await reply(applicant, req.id, []);
    assert.deepEqual([empty.status, empty.body.code], [400, "REPLY_REQUIRED"]);
    const fileNotAsked = await reply(applicant, req.id, [{ field: "additional", body: PDF(), type: "application/pdf" }], { responseText: "Next Monday." });
    assert.deepEqual([fileNotAsked.status, fileNotAsked.body.code], [400, "UNEXPECTED_FILE"]);
    assert.equal((await reply(applicant, req.id, [], { responseText: "Next Monday works for me." })).status, 201);

    const second = await makeApp();
    const req2 = (await ask(second.app.id, { kinds: ["ADDITIONAL"], message: "Please send any certificates you have." })).body;
    const four = await reply(second.applicant, req2.id, [1, 2, 3, 4].map(() => ({ field: "additional", body: PDF(), type: "application/pdf" })));
    assert.equal(four.status, 400);
    assert.equal((await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: req2.id } })).status, "OPEN");
  });

  test("two replies at once: exactly one is saved and the other's files are removed", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." })).body;
    const before = store.size;
    const results = await Promise.all([1, 2].map(() => reply(applicant, req.id, [{ field: "photo", body: PNG(), type: "image/png" }])));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.franchiseApplicationDocument.count({ where: { applicationId: app.id, kind: "PHOTO" } }), 1);
    assert.equal(store.size, before + 1, "the losing reply's file was deleted");
  });

  test("a storage failure part-way removes uploaded files and leaves the request open", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: ["ID_PROOF", "PHOTO"], message: "Please send a new ID proof and photograph." })).body;
    const before = store.size;
    uploads = 0;
    failUploadAfter = 2;
    try {
      const r = await reply(applicant, req.id, [{ field: "idProof", body: PDF(), type: "application/pdf" }, { field: "photo", body: PNG(), type: "image/png" }]);
      assert.deepEqual([r.status, r.body.code], [503, "STORAGE_UNAVAILABLE"]);
    } finally {
      failUploadAfter = Infinity;
    }
    assert.equal(store.size, before);
    assert.equal((await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "OPEN");
    assert.equal(await prisma.franchiseApplicationDocument.count({ where: { applicationId: app.id } }), 1);
  });
});

describe("cancelling and closing", () => {
  test("an admin can cancel an open request; a cancelled one can't be answered or cancelled again", async () => {
    const { app, applicant } = await makeApp();
    const req = (await ask(app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." })).body;
    sent.length = 0;
    const c = await call("POST", `/admin/franchise/applications/${app.id}/document-requests/${req.id}/cancel`, admin, { reason: "Asked by mistake" });
    assert.equal(c.status, 200);
    assert.equal(sent.length, 0, "no email on cancel");
    assert.equal((await call("POST", `/admin/franchise/applications/${app.id}/document-requests/${req.id}/cancel`, admin, {})).status, 409);
    assert.equal((await reply(applicant, req.id, [{ field: "photo", body: PNG(), type: "image/png" }])).status, 409);
    assert.equal((await audits(app.id, "FRANCHISE_DOCUMENT_REQUEST_CANCELLED")).length, 1);
    assert.equal((await call("POST", `/admin/franchise/applications/${app.id}/document-requests/${req.id}/cancel`, applicant, {})).status, 403);
  });

  test("rejecting or withdrawing the application cancels its open request", async () => {
    const one = await makeApp();
    const r1 = (await ask(one.app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." })).body;
    const rej = await call("POST", `/admin/franchise/applications/${one.app.id}/transition`, admin, { to: "REJECTED", expectedVersion: 0, rejectionReason: "Not a fit for this round of applications." });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    const c1 = await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: r1.id } });
    assert.deepEqual([c1.status, c1.cancelReason], ["CANCELLED", "Application rejected"]);

    const two = await makeApp();
    const r2 = (await ask(two.app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." })).body;
    assert.equal((await call("POST", "/franchise/applications/me/withdraw", two.applicant, {})).status, 200);
    assert.equal((await prisma.franchiseDocumentRequest.findUniqueOrThrow({ where: { id: r2.id } })).status, "CANCELLED");
    assert.equal((await reply(two.applicant, r2.id, [{ field: "photo", body: PNG(), type: "image/png" }])).status, 409);
  });

  test("the admin list shows Waiting / Reply received and filters by waiting", async () => {
    const waiting = await makeApp();
    await ask(waiting.app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." });
    const replied = await makeApp();
    const req = (await ask(replied.app.id, { kinds: [], message: "Please confirm your office address." })).body;
    await reply(replied.applicant, req.id, [], { responseText: "Confirmed." });
    const list = (await call("GET", `/admin/franchise/applications?q=ZZ-${short}&pageSize=100`, admin)).body.applications as { id: string; infoRequest: string | null }[];
    assert.equal(list.find((a) => a.id === waiting.app.id)?.infoRequest, "WAITING");
    assert.equal(list.find((a) => a.id === replied.app.id)?.infoRequest, "REPLIED");
    const filtered = (await call("GET", `/admin/franchise/applications?q=ZZ-${short}&info=WAITING&pageSize=100`, admin)).body.applications as { id: string }[];
    assert.ok(filtered.some((a) => a.id === waiting.app.id));
    assert.equal(filtered.some((a) => a.id === replied.app.id), false);
  });
});

describe("database guards", () => {
  test("what was asked never changes; answered or cancelled is final; never deleted; one open per application", async () => {
    const { app } = await makeApp();
    const req = (await ask(app.id, { kinds: ["PHOTO"], message: "Please send a recent photograph." })).body;
    await assert.rejects(prisma.franchiseDocumentRequest.update({ where: { id: req.id }, data: { message: "Something else entirely" } }), /never changes/);
    await assert.rejects(prisma.franchiseDocumentRequest.update({ where: { id: req.id }, data: { kinds: ["ID_PROOF"] } }), /never changes/);
    await assert.rejects(prisma.franchiseDocumentRequest.delete({ where: { id: req.id } }), /never deleted/);
    await assert.rejects(prisma.franchiseDocumentRequest.create({ data: { applicationId: app.id, message: "A second open request here", kinds: [], requestedById: admin.id } }), (e: { code?: string }) => e.code === "P2002");
    await assert.rejects(prisma.franchiseDocumentRequest.create({ data: { applicationId: app.id, message: "Born already answered here", kinds: [], requestedById: admin.id, status: "FULFILLED", fulfilledAt: new Date() } }), /start open/);
    await prisma.franchiseDocumentRequest.update({ where: { id: req.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await assert.rejects(prisma.franchiseDocumentRequest.update({ where: { id: req.id }, data: { status: "OPEN", cancelledAt: null } }), /final/);
    await assert.rejects(prisma.franchiseDocumentRequest.update({ where: { id: req.id }, data: { cancelReason: "changed later" } }), /final/);
  });
});

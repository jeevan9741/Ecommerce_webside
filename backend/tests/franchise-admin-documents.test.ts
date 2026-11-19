/**
 * Admin "View" for franchise applicant documents: a short-lived (5-minute) signed link per request,
 * admin-only (role read from the database; the second factor required while enforcement is on), never
 * cached, every link audited as FRANCHISE_DOCUMENT_VIEWED. Storage is replaced by an in-memory stand-in
 * that records each signing request. Applications are seeded directly; everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";

const signed: { key: string; seconds: number }[] = [];
let failSigning = false;
mock.module("../src/services/storage.service.js", {
  namedExports: {
    publicStoreConfigured: () => false,
    getUploadUrl: async (key: string) => ({ url: `https://blob.invalid/upload/${key}`, key }),
    getDownloadUrl: async (key: string, seconds = 300) => {
      if (failSigning) throw new Error("simulated storage outage");
      signed.push({ key, seconds });
      return `https://blob.invalid/${key}?expires=${seconds}&sig=${randomBytes(4).toString("hex")}`;
    },
    uploadBuffer: async () => ({}),
    deleteObject: async () => {},
    buildStorageKey: (prefix: string, filename: string) => `${prefix}/${filename}`,
    getClientUploadToken: async () => "test-token",
    readObjectHead: async () => Buffer.alloc(0),
    statObject: async () => null,
  },
});

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken, mfaFingerprint } = await import("../src/utils/tokens.js");
const { encryptJson } = await import("../src/utils/crypto.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const short = tag.slice(-6).toUpperCase();
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
let admin: U;
let otherAdmin: U;
let applicant: U;
let stranger: U;
let appId = "";
let otherAppId = "";
const docIds: Record<string, string> = {};
let otherDocId = "";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER"): Promise<U> {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `D${short}${userIds.length}`, role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  return { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

async function makeApp(user: U, n: number, districtId: string, stateId: string) {
  return prisma.franchiseApplication.create({
    data: {
      applicationNo: `ZZ-${short}-${n}`,
      userId: user.id,
      applicantName: `Applicant ${n}`,
      mobile: `9${String(810000000 + n)}`,
      email: user.email,
      stateId,
      districtId,
      address: `${n}, Test Street`,
      requiredDocumentKinds: ["ID_PROOF", "PHOTO"],
      history: { create: { toStatus: "APPLICATION_SUBMITTED", actorId: user.id, actorType: "APPLICANT", applicantNote: "Application submitted" } },
    },
  });
}

async function makeDoc(applicationId: string, uploadedById: string, kind: "ID_PROOF" | "PHOTO" | "ADDRESS_PROOF" | "BUSINESS_PLAN") {
  const d = await prisma.franchiseApplicationDocument.create({
    data: { applicationId, kind, storageKey: `franchise-applications/${applicationId}/${kind.toLowerCase()}-${randomBytes(8).toString("hex")}.pdf`, originalName: `${kind}.pdf`, mimeType: "application/pdf", sizeBytes: 100, sha256: "b".repeat(64), uploadedById },
  });
  return d.id;
}

async function call(method: string, path: string, user: { token: string } | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const urlPath = (applicationId: string, documentId: string) => `/admin/franchise/applications/${applicationId}/documents/${documentId}/url`;
const views = (applicationId: string) => prisma.auditLog.findMany({ where: { action: "FRANCHISE_DOCUMENT_VIEWED", target: applicationId }, orderBy: { createdAt: "asc" } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await makeUser("adm", "ADMIN");
  otherAdmin = await makeUser("adm2", "ADMIN");
  applicant = await makeUser("applicant");
  stranger = await makeUser("stranger");
  const other = await makeUser("other");
  const st = await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } });
  const d1 = await prisma.district.create({ data: { stateId: st.id, name: `${tag} d1`, isActive: true } });
  const st2 = await prisma.indiaState.create({ data: { name: `${tag} State2`, isActive: true } });
  const d2 = await prisma.district.create({ data: { stateId: st2.id, name: `${tag} d2`, isActive: true } });
  appId = (await makeApp(applicant, 1, d1.id, st.id)).id;
  otherAppId = (await makeApp(other, 2, d2.id, st2.id)).id;
  for (const kind of ["ID_PROOF", "PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN"] as const) docIds[kind] = await makeDoc(appId, applicant.id, kind);
  otherDocId = await makeDoc(otherAppId, other.id, "ID_PROOF");
});

after(async () => {
  delete process.env.ADMIN_MFA_ENFORCEMENT;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-admin-documents test cleanup'`;
      const apps = [appId, otherAppId].filter(Boolean);
      await tx.franchiseApplicationDocument.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...apps, ...userIds] } }] } });
      await tx.adminMfaFactor.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("admin document view", () => {
  test("an admin gets a 5-minute signed link for each document type, uncached and audited per view", async () => {
    for (const [kind, id] of Object.entries(docIds)) {
      signed.length = 0;
      const r = await call("POST", urlPath(appId, id), admin);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.body.expiresInSeconds, 300);
      assert.equal(r.body.fileName, `${kind}.pdf`);
      assert.match(r.body.url, /^https:\/\/blob\.invalid\/franchise-applications\//);
      assert.deepEqual(signed.map((s) => s.seconds), [300], "signed for 5 minutes, once per request");
      assert.equal(Object.keys(r.body).sort().join(","), "expiresInSeconds,fileName,url", "no storage key or other fields");
    }
    const rows = await views(appId);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.actorId, admin.id);
      const meta = row.metadata as Record<string, unknown>;
      assert.deepEqual(Object.keys(meta).sort(), ["applicationNo", "documentId", "expiresInSeconds", "kind"]);
      assert.equal(JSON.stringify(meta).includes("franchise-applications/"), false, "the audit never holds the storage key or link");
    }
    assert.deepEqual(rows.map((r) => (r.metadata as { kind: string }).kind).sort(), ["ADDRESS_PROOF", "BUSINESS_PLAN", "ID_PROOF", "PHOTO"]);
  });

  test("every click is a new link and a new audit row (nothing permanent)", async () => {
    const before = (await views(appId)).length;
    const a = await call("POST", urlPath(appId, docIds.ID_PROOF), otherAdmin);
    const b = await call("POST", urlPath(appId, docIds.ID_PROOF), otherAdmin);
    assert.equal(a.status, 200);
    assert.notEqual(a.body.url, b.body.url);
    assert.equal((await views(appId)).length, before + 2);
  });

  test("students, the applicant themselves and signed-out callers are refused, and nothing is signed or audited", async () => {
    const before = (await views(appId)).length;
    signed.length = 0;
    for (const [who, user, status] of [["signed out", null, 401], ["stranger", stranger, 403], ["applicant", applicant, 403]] as const) {
      const r = await call("POST", urlPath(appId, docIds.PHOTO), user);
      assert.equal(r.status, status, `${who}: ${JSON.stringify(r.body)}`);
      assert.equal(JSON.stringify(r.body ?? {}).includes("blob.invalid"), false);
    }
    // The GET form doesn't exist (a view must be an explicit, audited request).
    assert.equal((await call("GET", urlPath(appId, docIds.PHOTO), admin)).status, 404);
    assert.equal(signed.length, 0);
    assert.equal((await views(appId)).length, before);
  });

  test("a document of another application, or an unknown one, is not found", async () => {
    signed.length = 0;
    assert.equal((await call("POST", urlPath(appId, otherDocId), admin)).status, 404);
    assert.equal((await call("POST", urlPath(appId, "nope"), admin)).status, 404);
    assert.equal((await call("POST", urlPath("nope", docIds.ID_PROOF), admin)).status, 404);
    assert.equal(signed.length, 0);
  });

  test("a demoted admin's existing token is refused at once", async () => {
    const temp = await makeUser("temp-admin", "ADMIN");
    assert.equal((await call("POST", urlPath(appId, docIds.ID_PROOF), temp)).status, 200);
    await prisma.user.update({ where: { id: temp.id }, data: { role: "USER" } });
    assert.equal((await call("POST", urlPath(appId, docIds.ID_PROOF), temp)).status, 403);
  });

  test("with two-step verification enforced, only a session that passed the second factor gets a link", async () => {
    process.env.ADMIN_MFA_ENFORCEMENT = "on";
    try {
      const noFactor = await call("POST", urlPath(appId, docIds.ID_PROOF), admin);
      assert.deepEqual([noFactor.status, noFactor.body.code], [403, "MFA_ENROLLMENT_REQUIRED"]);
      // Factors start pending and are enabled once (database guard), as in the real enrolment.
      const pending = await prisma.adminMfaFactor.create({ data: { userId: admin.id, secretEncrypted: encryptJson({ s: "JBSWY3DPEHPK3PXP" }) } });
      const f = await prisma.adminMfaFactor.update({ where: { id: pending.id }, data: { enabledAt: new Date() } });
      const passwordOnly = await call("POST", urlPath(appId, docIds.ID_PROOF), admin);
      assert.deepEqual([passwordOnly.status, passwordOnly.body.code], [403, "MFA_REQUIRED"]);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      const verified = signSessionToken({ id: u.id, name: u.name, email: u.email, role: "ADMIN", referralCode: u.referralCode }, u.passwordHash, { mv: mfaFingerprint({ id: f.id, enabledAt: f.enabledAt! }) });
      const ok = await call("POST", urlPath(appId, docIds.ID_PROOF), { token: verified });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    } finally {
      delete process.env.ADMIN_MFA_ENFORCEMENT;
    }
  });

  test("a storage failure returns an error and audits nothing", async () => {
    const before = (await views(appId)).length;
    failSigning = true;
    try {
      const r = await call("POST", urlPath(appId, docIds.PHOTO), otherAdmin);
      assert.ok(r.status >= 500, String(r.status));
      assert.equal(JSON.stringify(r.body ?? {}).includes("blob.invalid"), false);
    } finally {
      failSigning = false;
    }
    assert.equal((await views(appId)).length, before);
  });
});

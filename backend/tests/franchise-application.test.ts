/**
 * Franchise Phase 4: states/districts (admin CRUD and CSV import), the public opportunity endpoints,
 * and application submission with private document uploads — through the real HTTP API.
 * Storage is replaced by an in-memory stand-in (no Blob store is ever touched); everything else —
 * policy gate, database constraints, ownership checks — is real. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
// These tests exercise the public/applicant franchise API, which is dark (404) unless switched on.
process.env.FRANCHISE_PUBLIC_ENABLED = "true";
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";

// ---- In-memory private store ----
const store = new Map<string, { body: Buffer; contentType: string }>();
let failUploadAfter = Infinity; // fail the Nth upload (1-based) to exercise cleanup
let uploads = 0;
const uploadOptions: ({ allowOverwrite?: boolean } | undefined)[] = [];
mock.module("../src/services/storage.service.js", {
  namedExports: {
    publicStoreConfigured: () => false,
    getUploadUrl: async (key: string) => ({ url: `https://blob.invalid/upload/${key}`, key }),
    getDownloadUrl: async (key: string, seconds = 300) => `https://blob.invalid/${key}?expires=${seconds}&sig=test`,
    uploadBuffer: async (key: string, body: Buffer, contentType: string, options?: { allowOverwrite?: boolean }) => {
      uploads += 1;
      uploadOptions.push(options);
      if (uploads >= failUploadAfter) throw new Error("simulated storage outage");
      store.set(key, { body, contentType });
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

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { signSessionToken } = await import("../src/utils/tokens.js");
const { APPROVED_STARTING_VALUES } = await import("../src/services/policy-schemas.js");
const { detectFileType } = await import("../src/services/franchise-application.service.js");
const { parseCsv, previewImport } = await import("../src/services/franchise-location.service.js");

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const num = () => String(900000 + Math.floor(Math.random() * 99999)); // test LGD-style codes
let server: Server;
let base = "";
const userIds: string[] = [];
type U = { id: string; token: string; email: string };
const people: Record<string, U> = {};
const loc = { stateId: "", otherStateId: "", heldStateId: "", d1: "", d2: "", d3: "", dHeld: "", dInactive: "", dOther: "" };
let privacy = { version: 0, sha256: "", text: "" };

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER", verified = true) {
  const u = await prisma.user.create({
    data: {
      name,
      email: `${tag}-${name}@example.test`,
      username: `${tag}-${name}`,
      passwordHash: "x",
      referralCode: `F${tag.slice(-8)}${userIds.length}`.toUpperCase(),
      role,
      emailVerified: verified ? new Date() : null,
    },
  });
  userIds.push(u.id);
  people[name] = { id: u.id, email: u.email, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
  return people[name];
}

// Each request gets its own client address (trust proxy is on) so the per-IP limit doesn't couple tests.
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(method: string, path: string, user: U | null, body?: unknown, fixedIp?: string) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "X-Forwarded-For": fixedIp ?? ip(), ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

// ---- Files ----
const PDF = (extra = "") => Buffer.from(`%PDF-1.4\n% ${tag} ${extra}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const JPG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
type FilePart = { field: string; name: string; type: string; body: Buffer };
const file = (field: string, body: Buffer, type: string, name = `${field}.${type.split("/")[1]}`): FilePart => ({ field, name, type, body });

function fields(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    applicantName: "Test Applicant",
    mobile: "9876543210",
    stateId: loc.stateId,
    districtId: loc.d1,
    address: "12, Test Street, Test Nagar, 500001",
    education: "B.Com",
    businessExperience: "Five years running a training centre",
    officeAvailable: "true",
    investmentCapacityInr: "500000",
    privacyNoticeAccepted: "true",
    privacyNoticeVersion: String(privacy.version),
    privacyNoticeSha256: privacy.sha256,
  };
  return { ...base, ...over };
}
const standardFiles = () => [file("idProof", PDF("id"), "application/pdf"), file("photo", JPG(), "image/jpeg"), file("addressProof", PNG(), "image/png")];

async function apply(user: U | null, f: Record<string, string | undefined>, files: FilePart[] = standardFiles(), fixedIp?: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(f)) if (v !== undefined) form.append(k, v);
  for (const p of files) form.append(p.field, new Blob([new Uint8Array(p.body)], { type: p.type }), p.name);
  const res = await fetch(`${base}/api/franchise/applications`, {
    method: "POST",
    headers: { "X-Forwarded-For": fixedIp ?? ip(), ...(user ? { Authorization: `Bearer ${user.token}` } : {}) },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ---- Policy publication (two admins, real API) ----
async function publishCommercial(over: Record<string, unknown>) {
  await publishPolicy("COMMERCIAL", over);
}
async function publishPolicy(domain: "COMMERCIAL" | "REVENUE_SHARE", over: Record<string, unknown>) {
  const payload = { ...APPROVED_STARTING_VALUES[domain], ...over };
  const d = await call("POST", "/admin/franchise/policies", people.admA, { domain, payload });
  assert.equal(d.status, 201, d.text);
  const s = await call("POST", `/admin/franchise/policies/${d.body.policy.id}/submit`, people.admA, { expectedSha: d.body.policy.payloadSha256, reason: "Phase 4 test configuration", effectiveFrom: null });
  assert.equal(s.status, 200, s.text);
  const a = await call("POST", `/admin/franchise/approvals/${s.body.request.id}/approve`, people.admB, { expectedPayloadSha: s.body.request.payloadSha256 });
  assert.equal(a.status, 200, a.text);
}
const DOCS = { PHOTO: "REQUIRED", ADDRESS_PROOF: "OPTIONAL", BUSINESS_PLAN: "OPTIONAL" };
const PRIVACY_TEXT = `DRAFT ${tag}: test-only privacy notice placeholder, pending legal approval (automated test text).`;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await makeUser("admA", "ADMIN");
  await makeUser("admB", "ADMIN");
  // Locations through the admin API.
  const st = await call("POST", "/admin/franchise/locations/states", people.admA, { name: `${tag} State`, code: num() });
  assert.equal(st.status, 201, st.text);
  loc.stateId = st.body.id;
  const st2 = await call("POST", "/admin/franchise/locations/states", people.admA, { name: `${tag} Other`, code: num() });
  loc.otherStateId = st2.body.id;
  // The held district lives in its own state: one franchise per state, so a hold closes the whole state.
  const st3 = await call("POST", "/admin/franchise/locations/states", people.admA, { name: `${tag} Held`, code: num() });
  loc.heldStateId = st3.body.id;
  for (const [key, stateId] of [["d1", loc.stateId], ["d2", loc.stateId], ["d3", loc.stateId], ["dHeld", loc.heldStateId], ["dInactive", loc.stateId], ["dOther", loc.otherStateId]] as const) {
    const r = await call("POST", "/admin/franchise/locations/districts", people.admA, { stateId, name: `${tag} ${key}`, code: num() });
    assert.equal(r.status, 201, r.text);
    loc[key] = r.body.id;
    assert.equal(r.body.isActive, false, "new districts start disabled");
  }
  // Verified by the admin and enabled (the count must match what they reviewed).
  for (const [stateId, expectedDistricts] of [[loc.stateId, 4], [loc.otherStateId, 1], [loc.heldStateId, 1]] as const) {
    const on = await call("POST", `/admin/franchise/locations/states/${stateId}/activate`, people.admA, { confirm: true, expectedDistricts });
    assert.equal(on.status, 200, on.text);
  }
  const off = await call("PATCH", `/admin/franchise/locations/districts/${loc.dInactive}`, people.admA, { isActive: false });
  assert.equal(off.status, 200, off.text);
});

after(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-application test cleanup'`;
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((a) => a.id);
      const districts = (await tx.district.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((d) => d.id);
      await tx.districtAllocationEvent.deleteMany({ where: { districtId: { in: districts } } });
      await tx.districtAllocation.deleteMany({ where: { districtId: { in: districts } } });
      await tx.stateAllocationEvent.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.stateAllocation.deleteMany({ where: { state: { name: { startsWith: tag } } } });
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchisePrivacyNoticeAcceptance.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationDocument.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { id: { in: districts } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      const policies = (await tx.policyVersion.findMany({ where: { createdById: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...policies, ...apps] } }] } });
      await tx.policyVersion.deleteMany({ where: { id: { in: policies } } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
  } finally {
    server.close();
  }
});

describe("unit: file detection and CSV parsing", () => {
  test("file type comes from the bytes, not the name", () => {
    assert.deepEqual(detectFileType(PDF()), { mime: "application/pdf", ext: "pdf" });
    assert.deepEqual(detectFileType(PNG()), { mime: "image/png", ext: "png" });
    assert.deepEqual(detectFileType(JPG()), { mime: "image/jpeg", ext: "jpg" });
    assert.equal(detectFileType(Buffer.from("MZ\x90\x00 executable")), null);
    assert.equal(detectFileType(Buffer.from("<svg onload=alert(1)>")), null);
    assert.equal(detectFileType(Buffer.alloc(0)), null);
  });

  test("CSV parsing handles quotes, embedded commas and CRLF", () => {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  });

  test("import preview refuses a bad header, non-numeric codes, inconsistent state names and duplicates", async () => {
    const H = "state_code,state_name,district_code,district_name";
    const bad = await previewImport("code,name\n1,x");
    assert.equal(bad.valid, false);
    assert.match(bad.errors.join(" "), /Header must be exactly/);
    assert.match((await previewImport(`${H}\nAB,${tag} St,1,${tag} D`)).errors.join(" "), /state_code must be numeric/);
    const p = await previewImport(`${H}\n991001,${tag} Imp,991101,${tag} Alpha\n991001,${tag} Imp Renamed,991102,${tag} Beta\n991001,${tag} Imp,991101,${tag} Gamma\n991001,${tag} Imp,991103,${tag} alpha`);
    const all = p.errors.join(" | ");
    assert.match(all, /is both/);
    assert.match(all, /district_code 991101 repeats/);
    assert.match(all, /repeats line 2 in the same state/);
    assert.equal(p.valid, false);
  });
});

describe("intake gate", () => {
  test("with no published decision the form is closed and nothing is stored", async () => {
    const info = await call("GET", "/franchise/info", null);
    assert.equal(info.status, 200);
    // Another suite may have left nothing published; either way it must not be open before this suite opens it.
    assert.equal(info.body.open, false, JSON.stringify(info.body));
    const u = await makeUser("early");
    const before = store.size;
    const r = await apply(u, fields());
    assert.deepEqual([r.status, r.body.code], [409, "APPLICATIONS_CLOSED"]);
    assert.equal(store.size, before, "no upload when closed");
  });

  test("a published policy with intake CLOSED keeps it closed", async () => {
    await publishCommercial({ applicationIntake: "CLOSED", documentRequirements: DOCS, privacyNotice: { text: PRIVACY_TEXT } });
    const info = await call("GET", "/franchise/info", null);
    assert.equal(info.body.open, false);
    assert.match(info.body.reasons.join(" "), /closed/i);
  });

  test("intake OPEN stays closed while the privacy notice is PENDING", async () => {
    await publishCommercial({ applicationIntake: "OPEN", documentRequirements: DOCS, });
    const info = await call("GET", "/franchise/info", null);
    assert.equal(info.body.open, false);
    assert.match(info.body.reasons.join(" "), /privacy notice/i);
    assert.equal(info.body.privacyNotice, null);
  });

  test("intake OPEN with documents and privacy notice decided opens it — no refund policy is needed or shown; GST still PENDING", async () => {
    await publishCommercial({ applicationIntake: "OPEN", documentRequirements: DOCS, privacyNotice: { text: PRIVACY_TEXT } });
    const info = await call("GET", "/franchise/info", null);
    assert.equal(info.body.open, true, JSON.stringify(info.body.reasons));
    assert.equal(info.body.franchiseFeeGst, "PENDING");
    assert.equal("refundPolicy" in info.body, false, "no customer-facing refund policy");
    assert.deepEqual(info.body.documentRequirements, DOCS);
    assert.equal(info.body.privacyNotice.text, PRIVACY_TEXT);
    assert.equal(info.body.privacyNotice.sha256, createHash("sha256").update(PRIVACY_TEXT).digest("hex"));
    assert.equal(info.body.privacyNotice.version, info.body.policy.version, "versioned with the COMMERCIAL policy");
    privacy = info.body.privacyNotice;
  });

  test("the page shows only the published revenue split — the two shares and the policy version, nothing else", async () => {
    await publishPolicy("REVENUE_SHARE", {});
    const info = await call("GET", "/franchise/info", null);
    assert.equal(info.status, 200);
    assert.deepEqual(Object.keys(info.body.revenueShare).sort(), ["etaShareBps", "partnerShareBps", "version"]);
    assert.deepEqual([info.body.revenueShare.partnerShareBps, info.body.revenueShare.etaShareBps], [8000, 2000]);
    assert.equal(Number.isInteger(info.body.revenueShare.version), true);
  });
});

describe("public locations", () => {
  test("availability is per STATE (from allocations only): a reserved state closes all its districts; others stay open", async () => {
    // Reserve the held state for an applicant's application there (created through the API, then a direct hold).
    const holder = await makeUser("holder");
    const ok = await apply(holder, fields({ stateId: loc.heldStateId, districtId: loc.dHeld }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await prisma.stateAllocation.create({ data: { stateId: loc.heldStateId, status: "RESERVED", reservedAt: new Date(), applicationId: ok.body.id, createdById: people.admA.id } });

    const r = await call("GET", "/franchise/locations", null);
    const open = r.body.states.find((s: { id: string }) => s.id === loc.stateId);
    const held = r.body.states.find((s: { id: string }) => s.id === loc.heldStateId);
    assert.equal(open.availability, "AVAILABLE");
    assert.equal(held.availability, "RESERVED");
    const byId = Object.fromEntries(open.districts.map((d: { id: string; available: boolean }) => [d.id, d.available]));
    assert.deepEqual([byId[loc.d1], byId[loc.d2], byId[loc.d3]], [true, true, true], "every centre district of an available state is selectable");
    assert.ok(held.districts.every((d: { available: boolean }) => !d.available), "no district of a reserved state is selectable");
    assert.equal(loc.dInactive in byId, false, "inactive districts are not listed");
    assert.doesNotMatch(r.text, /applications|userId|email/i, "no applicant data on the public list");
  });

  test("a second PRIMARY hold on the same state is refused by the database", async () => {
    const other = await makeUser("otherHolder");
    const ok = await apply(other, fields({ districtId: loc.d1 }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await assert.rejects(
      prisma.stateAllocation.create({ data: { stateId: loc.heldStateId, status: "RESERVED", reservedAt: new Date(), applicationId: ok.body.id, createdById: people.admA.id } }),
      (e: { code?: string }) => e.code === "P2002"
    );
  });
});

describe("submission", () => {
  test("anonymous is refused before any upload is buffered; unverified email is refused", async () => {
    assert.equal((await apply(null, fields())).status, 401);
    const u = await makeUser("unverified", "USER", false);
    const r = await apply(u, fields());
    assert.deepEqual([r.status, r.body.code], [403, "EMAIL_NOT_VERIFIED"]);
  });

  test("validation: mobile, location, state availability, documents", async () => {
    // A fresh account per case: every attempt counts toward the per-account rate limit.
    const expect = async (label: string, f: Record<string, string | undefined>, files: FilePart[] | undefined, status: number, code: string) => {
      const r = await apply(await makeUser(`v-${label.replace(/\W+/g, "-")}`), f, files);
      assert.deepEqual([r.status, r.body.code], [status, code], `${label}: ${JSON.stringify(r.body)}`);
    };
    await expect("mobile", fields({ mobile: "1234567890" }), undefined, 400, "INVALID_APPLICATION");
    await expect("investment float", fields({ investmentCapacityInr: "1000.50" }), undefined, 400, "INVALID_APPLICATION");
    await expect("investment cap", fields({ investmentCapacityInr: "1000000001" }), undefined, 400, "INVALID_APPLICATION");
    await expect("district of another state", fields({ districtId: loc.dOther }), undefined, 400, "INVALID_LOCATION");
    await expect("inactive district", fields({ districtId: loc.dInactive }), undefined, 400, "INVALID_LOCATION");
    await expect("reserved state", fields({ stateId: loc.heldStateId, districtId: loc.dHeld }), undefined, 409, "STATE_RESERVED");
  });

  test("documents: ID proof always, photo when required, type by content, one per field, size limit", async () => {
    const u = await makeUser("docs");
    const f = fields({ districtId: loc.d2 });
    const go = (files: FilePart[]) => apply(u, f, files);
    const id = file("idProof", PDF(), "application/pdf");
    const photo = file("photo", JPG(), "image/jpeg");
    let r = await go([photo]);
    assert.deepEqual([r.status, r.body.code, r.body.field], [400, "DOCUMENT_REQUIRED", "idProof"]);
    r = await go([id]);
    assert.deepEqual([r.status, r.body.code, r.body.field], [400, "DOCUMENT_REQUIRED", "photo"]);
    r = await go([file("idProof", Buffer.from("MZ not a pdf"), "application/pdf", "id.pdf"), photo]);
    assert.deepEqual([r.status, r.body.code], [415, "UNSUPPORTED_FILE"]);
    r = await go([file("idProof", PNG(), "application/pdf", "id.pdf"), photo]);
    assert.deepEqual([r.status, r.body.code], [415, "FILE_TYPE_MISMATCH"]);
    r = await go([id, photo, file("resume", PDF(), "application/pdf")]);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    r = await go([id, file("idProof", PDF("2"), "application/pdf"), photo]);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    r = await go([file("idProof", Buffer.concat([PDF(), Buffer.alloc(5 * 1024 * 1024)]), "application/pdf"), photo]);
    assert.deepEqual([r.status, r.body.code], [413, "FILE_TOO_LARGE"]);
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 0);
  });

  test("a valid application is stored with private documents, history, audit without personal data, and a notification", async () => {
    const u = await makeUser("applicant");
    const before = store.size;
    const r = await apply(u, fields({ applicantName: "Applicant One", email: "attacker@example.test" } as Record<string, string>));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.applicationNo, new RegExp(`^FA-${new Date().getUTCFullYear()}-\\d{6}$`));
    const app = await prisma.franchiseApplication.findUniqueOrThrow({ where: { id: r.body.id }, include: { documents: true, history: true } });
    assert.equal(app.email, u.email, "email is the verified account email, not a form field");
    assert.equal(app.status, "APPLICATION_SUBMITTED");
    assert.deepEqual([...app.requiredDocumentKinds].sort(), ["ID_PROOF", "PHOTO"]);
    assert.deepEqual([app.refundPolicyVersion, app.refundPolicyText, app.refundPolicySha256], [null, null, null], "no refund acknowledgement is recorded");
    assert.equal(app.investmentCapacityInr, 500000);
    assert.equal(app.documents.length, 3);
    for (const d of app.documents) {
      assert.match(d.storageKey, new RegExp(`^franchise-applications/${app.id}/[a-z_]+-[0-9a-f]{16}\\.(pdf|jpg|png)$`));
      const stored = store.get(d.storageKey);
      assert.ok(stored, "uploaded to the (private) store");
      assert.equal(d.sha256, createHash("sha256").update(stored.body).digest("hex"));
      assert.equal(d.sizeBytes, stored.body.length);
    }
    assert.equal(store.size, before + 3);
    assert.ok(uploadOptions.length > 0 && uploadOptions.every((o) => o?.allowOverwrite === false), "documents are uploaded with overwrite refused");
    assert.deepEqual(app.history.map((h) => [h.toStatus, h.actorType, h.actorId]), [["APPLICATION_SUBMITTED", "APPLICANT", u.id]]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_APPLICATION_SUBMITTED", target: app.id } });
    const meta = JSON.stringify(audit.metadata);
    for (const pii of ["Applicant One", "9876543210", u.email, "Test Street"]) assert.equal(meta.includes(pii), false, `audit must not contain ${pii}`);
    const n = await prisma.franchiseNotification.findFirstOrThrow({ where: { applicationId: app.id } });
    assert.deepEqual([n.kind, n.status, n.recipientUserId], ["APPLICATION_SUBMITTED", "SENT", u.id]);
  });

  test("one open application per account: a second submission is refused and leaves no files", async () => {
    const u = people.applicant;
    const before = store.size;
    const r = await apply(u, fields({ districtId: loc.d2 }));
    assert.deepEqual([r.status, r.body.code], [409, "APPLICATION_EXISTS"]);
    assert.equal(store.size, before);
  });

  test("concurrent double submission by one account: exactly one wins and the loser's files are removed", async () => {
    const u = await makeUser("racer");
    const before = store.size;
    const results = await Promise.all([apply(u, fields({ districtId: loc.d2 })), apply(u, fields({ districtId: loc.d2 })), apply(u, fields({ districtId: loc.d2 }))]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 409, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 1);
    assert.equal(store.size, before + 3, "only the winner's three documents remain");
  });

  test("concurrent submissions by different accounts get distinct sequential numbers", async () => {
    const us = [await makeUser("seqA"), await makeUser("seqB"), await makeUser("seqC")];
    const rs = await Promise.all(us.map((u) => apply(u, fields({ districtId: loc.d2 }))));
    assert.deepEqual(rs.map((r) => r.status), [201, 201, 201], JSON.stringify(rs.map((r) => r.body)));
    const nos = rs.map((r) => Number(r.body.applicationNo.slice(-6))).sort((a, b) => a - b);
    assert.equal(new Set(nos).size, 3);
    assert.deepEqual([nos[1] - nos[0], nos[2] - nos[1]], [1, 1]);
  });

  test("a storage failure part-way removes the files already uploaded and saves nothing", async () => {
    const u = await makeUser("outage");
    const before = store.size;
    uploads = 0;
    failUploadAfter = 3;
    try {
      const r = await apply(u, fields({ districtId: loc.d2 }));
      assert.deepEqual([r.status, r.body.code], [503, "STORAGE_UNAVAILABLE"]);
    } finally {
      failUploadAfter = Infinity;
    }
    assert.equal(store.size, before, "uploads 1-2 were removed");
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 0);
  });

  test("rate limit: an account is limited to 5 submission attempts an hour", async () => {
    const u = await makeUser("limited");
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await apply(u, fields({ mobile: "123" }))).status);
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  });
});

describe("the applicant's own view and document privacy", () => {
  test("applicant sees their application and timeline; never a storage key", async () => {
    const r = await call("GET", "/franchise/applications/me", people.applicant);
    assert.equal(r.status, 200);
    assert.equal(r.body.application.statusLabel, "Application submitted");
    assert.equal(r.body.application.documents.length, 3);
    assert.equal(r.body.application.timeline.length, 1);
    assert.doesNotMatch(r.text, /storageKey|franchise-applications\/|blob\.invalid/);
  });

  test("another account sees nothing; anonymous is refused", async () => {
    const other = await makeUser("nosy");
    assert.equal((await call("GET", "/franchise/applications/me", other)).body.application, null);
    assert.equal((await call("GET", "/franchise/applications/me", null)).status, 401);
  });

  test("signed links: only the owner gets one, short-lived and uncached; others get 404", async () => {
    const mine = await call("GET", "/franchise/applications/me", people.applicant);
    const docId = mine.body.application.documents[0].id;
    const ok = await fetch(`${base}/api/franchise/applications/me/documents/${docId}/url`, { headers: { Authorization: `Bearer ${people.applicant.token}`, "X-Forwarded-For": ip() } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const body = await ok.json();
    assert.equal(body.expiresInSeconds, 60);
    assert.match(body.url, /expires=60/);
    assert.equal((await call("GET", `/franchise/applications/me/documents/${docId}/url`, people.nosy)).status, 404);
    assert.equal((await call("GET", `/franchise/applications/me/documents/${docId}/url`, people.admA)).status, 404, "applicant route is owner-only, even for admins");
    assert.equal((await call("GET", `/franchise/applications/me/documents/${docId}/url`, null)).status, 401);
    assert.equal((await call("GET", `/franchise/applications/me/documents/does-not-exist/url`, people.applicant)).status, 404);
  });

  test("documents and history can't be altered in the database", async () => {
    const d = await prisma.franchiseApplicationDocument.findFirstOrThrow({ where: { application: { userId: people.applicant.id } } });
    await assert.rejects(prisma.franchiseApplicationDocument.update({ where: { id: d.id }, data: { storageKey: "elsewhere" } }), /append-only/);
    await assert.rejects(prisma.franchiseApplicationDocument.delete({ where: { id: d.id } }), /append-only/);
  });
});

describe("admin locations", () => {
  test("new locations start disabled and stay hidden until an admin verifies and enables them", async () => {
    const st = await call("POST", "/admin/franchise/locations/states", people.admA, { name: `${tag} Unverified`, code: num() });
    assert.equal(st.body.isActive, false);
    const d = await call("POST", "/admin/franchise/locations/districts", people.admA, { stateId: st.body.id, name: `${tag} Unverified D`, code: num() });
    assert.equal(d.body.isActive, false);
    const pub = await call("GET", "/franchise/locations", null);
    assert.equal(pub.body.states.some((s: { id: string }) => s.id === st.body.id), false, "not offered to applicants");
    const r = await apply(await makeUser("unverified-district"), fields({ stateId: st.body.id, districtId: d.body.id }));
    assert.deepEqual([r.status, r.body.code], [400, "INVALID_LOCATION"]);
    const noConfirm = await call("POST", `/admin/franchise/locations/states/${st.body.id}/activate`, people.admA, { expectedDistricts: 1 });
    assert.deepEqual([noConfirm.status, noConfirm.body.code], [400, "CONFIRMATION_REQUIRED"]);
    const stale = await call("POST", `/admin/franchise/locations/states/${st.body.id}/activate`, people.admA, { confirm: true, expectedDistricts: 3 });
    assert.deepEqual([stale.status, stale.body.code], [409, "STALE"]);
    assert.equal((await call("POST", `/admin/franchise/locations/states/${st.body.id}/activate`, people.applicant, { confirm: true, expectedDistricts: 1 })).status, 403);
    const audit = await prisma.auditLog.count({ where: { action: "FRANCHISE_STATE_ACTIVATED", target: st.body.id } });
    assert.equal(audit, 0, "nothing enabled by the refused attempts");
  });

  test("no route enables an unverified location without explicit confirmation (direct API bypass attempts)", async () => {
    const S = "/admin/franchise/locations/states";
    const D = "/admin/franchise/locations/districts";
    const st = await call("POST", S, people.admA, { name: `${tag} Bypass`, code: num() });
    const dCode = num();
    const d = await call("POST", D, people.admA, { stateId: st.body.id, name: `${tag} Bypass D`, code: dCode });
    const isActive = async () => [(await prisma.indiaState.findUniqueOrThrow({ where: { id: st.body.id } })).isActive, (await prisma.district.findUniqueOrThrow({ where: { id: d.body.id } })).isActive];
    const refused = async (label: string, method: string, path: string, user: U | null, body: unknown, status: number, code?: string) => {
      const r = await call(method, path, user, body);
      assert.equal(r.status, status, `${label}: ${r.text}`);
      if (code) assert.equal(r.body.code, code, label);
    };
    // District: every unconfirmed or malformed enable is refused.
    await refused("district, no confirm", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true }, 400, "CONFIRMATION_REQUIRED");
    await refused("district, confirm false", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true, confirm: false }, 400, "CONFIRMATION_REQUIRED");
    await refused("district, confirm as string", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true, confirm: "true" }, 400, "CONFIRMATION_REQUIRED");
    await refused("district, confirm as 1", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true, confirm: 1 }, 400, "CONFIRMATION_REQUIRED");
    await refused("district, isActive as string", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: "true", confirm: true }, 400, "INVALID_REQUEST");
    await refused("district, non-admin", "PATCH", `${D}/${d.body.id}`, people.applicant, { isActive: true, confirm: true }, 403);
    await refused("district, anonymous", "PATCH", `${D}/${d.body.id}`, null, { isActive: true, confirm: true }, 401);
    // State: the same rule.
    await refused("state, no confirm", "PATCH", `${S}/${st.body.id}`, people.admA, { isActive: true }, 400, "CONFIRMATION_REQUIRED");
    await refused("state, confirm as string", "PATCH", `${S}/${st.body.id}`, people.admA, { isActive: true, confirm: "yes" }, 400, "CONFIRMATION_REQUIRED");
    await refused("state, non-admin", "PATCH", `${S}/${st.body.id}`, people.applicant, { isActive: true, confirm: true }, 403);
    await refused("activate endpoint, confirm as string", "POST", `${S}/${st.body.id}/activate`, people.admA, { confirm: "true", expectedDistricts: 1 }, 400, "CONFIRMATION_REQUIRED");
    await refused("unknown district", "PATCH", `${D}/does-not-exist`, people.admA, { isActive: true, confirm: true }, 404);
    // Editing other fields never enables.
    const renamed = await call("PATCH", `${D}/${d.body.id}`, people.admA, { name: `${tag} Bypass D2` });
    assert.equal(renamed.status, 200, renamed.text);
    // Re-importing the district's official code (a rename) keeps it disabled.
    const csv = `state_code,state_name,district_code,district_name\n${st.body.code},${tag} Bypass,${dCode},${tag} Bypass D3\n`;
    const pv = await call("POST", "/admin/franchise/locations/import/preview", people.admA, { csv, source: "bypass check" });
    assert.equal(pv.body.valid, true, pv.text);
    const ap = await call("POST", "/admin/franchise/locations/import/apply", people.admA, { csv, expectedSha256: pv.body.fileSha256, source: "bypass check", confirm: true });
    assert.equal(ap.status, 200, ap.text);
    assert.deepEqual(await isActive(), [false, false], "nothing was enabled by any refused attempt, edit or import");
    assert.equal(await prisma.auditLog.count({ where: { target: { in: [st.body.id, d.body.id] }, action: { in: ["FRANCHISE_STATE_ACTIVATED", "FRANCHISE_DISTRICT_ACTIVATED"] } } }), 0);
    const pub = await call("GET", "/franchise/locations", null);
    assert.equal(pub.body.states.some((s: { id: string }) => s.id === st.body.id), false);

    // The confirmed paths work, and each enable is audited as a verified activation.
    const onState = await call("PATCH", `${S}/${st.body.id}`, people.admA, { isActive: true, confirm: true });
    assert.equal(onState.status, 200, onState.text);
    const onDistrict = await call("PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true, confirm: true });
    assert.equal(onDistrict.status, 200, onDistrict.text);
    assert.deepEqual(await isActive(), [true, true]);
    for (const [target, action] of [[st.body.id, "FRANCHISE_STATE_ACTIVATED"], [d.body.id, "FRANCHISE_DISTRICT_ACTIVATED"]]) {
      const a = await prisma.auditLog.findFirstOrThrow({ where: { target, action } });
      assert.equal((a.metadata as { verifiedConfirmed?: boolean }).verifiedConfirmed, true);
      assert.equal(a.actorId, people.admA.id);
    }
    // Disabling never needs confirmation, and re-enabling needs it again.
    assert.equal((await call("PATCH", `${D}/${d.body.id}`, people.admA, { isActive: false })).status, 200);
    await refused("re-enable without confirm", "PATCH", `${D}/${d.body.id}`, people.admA, { isActive: true }, 400, "CONFIRMATION_REQUIRED");
    // Sending isActive: true for an already-enabled location is not an activation and needs no confirmation.
    assert.equal((await call("PATCH", `${S}/${st.body.id}`, people.admA, { isActive: true, name: `${tag} Bypass` })).status, 200);
  });

  test("the review CSV (states marked TO_VERIFY_AGAINST_LGD) can't be imported as a district file", async () => {
    const review = "state_code,state_name,type,verification_status\n1,Jammu and Kashmir,UT,TO_VERIFY_AGAINST_LGD\n";
    const p = await call("POST", "/admin/franchise/locations/import/preview", people.admA, { csv: review, source: "review file" });
    assert.equal(p.body.valid, false);
    assert.match(p.body.errors.join(" "), /Header must be exactly/);
  });

  test("non-admins can't read or change locations", async () => {
    const u = people.applicant;
    assert.equal((await call("GET", "/admin/franchise/locations", u)).status, 403);
    assert.equal((await call("POST", "/admin/franchise/locations/states", u, { name: `${tag} X` })).status, 403);
    assert.equal((await call("POST", "/admin/franchise/locations/import/apply", null, {})).status, 401);
  });

  test("duplicates are refused; admin list shows held and open-application counts", async () => {
    const dup = await call("POST", "/admin/franchise/locations/districts", people.admA, { stateId: loc.stateId, name: `${tag} d1` });
    assert.deepEqual([dup.status, dup.body.code], [409, "DUPLICATE_LOCATION"]);
    const list = await call("GET", "/admin/franchise/locations", people.admA);
    const st = list.body.states.find((s: { id: string }) => s.id === loc.stateId);
    const d = Object.fromEntries(st.districts.map((x: { id: string }) => [x.id, x]));
    const heldState = list.body.states.find((s: { id: string }) => s.id === loc.heldStateId);
    assert.equal(heldState.availability, "RESERVED", "the admin list shows the state's availability");
    assert.equal(heldState.districts[0].held, true, "a district is held while its state is");
    assert.equal(d[loc.d1].held, false);
    assert.ok(d[loc.d2].openApplications >= 4, JSON.stringify(d[loc.d2]));
    assert.equal(d[loc.dInactive].isActive, false);
  });

  test("CSV import: preview, stale hash refused, apply upserts by code, never deletes, audited", async () => {
    const sc = String(90000 + Math.floor(Math.random() * 9999)); // 5 digits, so district codes ${sc}N stay within 6
    const csv1 = `state_code,state_name,district_code,district_name\n${sc},${tag} Imported,${sc}1,${tag} Imp Alpha\n${sc},${tag} Imported,${sc}2,${tag} Imp Beta\n`;
    const p1 = await call("POST", "/admin/franchise/locations/import/preview", people.admA, { csv: csv1, source: "LGD test file" });
    assert.equal(p1.status, 200, p1.text);
    assert.deepEqual([p1.body.plan.newStates, p1.body.plan.newDistricts, p1.body.valid], [1, 2, true], p1.text);
    // The preview names the source and lists exactly what would be added.
    assert.equal(p1.body.source, "LGD test file");
    assert.deepEqual(p1.body.changes.addedStates, [{ code: sc, name: `${tag} Imported` }]);
    assert.deepEqual(p1.body.changes.addedDistricts.map((d: { code: string }) => d.code), [`${sc}1`, `${sc}2`]);
    assert.ok(p1.body.changes.missingDistricts.length >= 1, "existing districts absent from the file are listed");
    const unconfirmed = await call("POST", "/admin/franchise/locations/import/apply", people.admA, { csv: csv1, expectedSha256: p1.body.fileSha256, source: "LGD test file" });
    assert.deepEqual([unconfirmed.status, unconfirmed.body.code], [400, "CONFIRMATION_REQUIRED"]);
    const stale = await call("POST", "/admin/franchise/locations/import/apply", people.admA, { csv: csv1, expectedSha256: "b".repeat(64), source: "LGD test file", confirm: true });
    assert.equal(stale.status, 409, stale.text);
    const a1 = await call("POST", "/admin/franchise/locations/import/apply", people.admA, { csv: csv1, expectedSha256: p1.body.fileSha256, source: "LGD test file", confirm: true });
    assert.equal(a1.status, 200, a1.text);
    // Second file renames one district and omits the other: rename applied, omission only reported.
    const csv2 = `state_code,state_name,district_code,district_name\n${sc},${tag} Imported,${sc}1,${tag} Imp Alpha Renamed\n`;
    const p2 = await call("POST", "/admin/franchise/locations/import/preview", people.admA, { csv: csv2, source: "LGD test file v2" });
    assert.equal(p2.body.plan.renamedDistricts, 1);
    assert.deepEqual(p2.body.changes.renamedDistricts, [{ code: `${sc}1`, from: `${tag} Imp Alpha`, to: `${tag} Imp Alpha Renamed` }]);
    assert.ok(p2.body.changes.missingDistricts.some((d: { code: string }) => d.code === `${sc}2`), "the omitted district is listed as missing");
    assert.ok(p2.body.notInFile >= 1, p2.text);
    // A district name that already exists under a different code is flagged, not silently re-coded.
    const p3 = await call("POST", "/admin/franchise/locations/import/preview", people.admA, { csv: `state_code,state_name,district_code,district_name\n${sc},${tag} Imported,${sc}9,${tag} Imp Beta\n` });
    assert.equal(p3.body.valid, false);
    assert.match(p3.body.errors.join(" "), /already exists with code/);
    const a2 = await call("POST", "/admin/franchise/locations/import/apply", people.admA, { csv: csv2, expectedSha256: p2.body.fileSha256, source: "LGD test file v2", confirm: true });
    assert.equal(a2.status, 200, a2.text);
    const rows = await prisma.district.findMany({ where: { code: { in: [`${sc}1`, `${sc}2`] } }, orderBy: { code: "asc" } });
    // Imported rows start disabled; the omitted one still exists (never deleted).
    assert.deepEqual(rows.map((r) => [r.name, r.isActive]), [[`${tag} Imp Alpha Renamed`, false], [`${tag} Imp Beta`, false]]);
    assert.equal((await prisma.indiaState.findFirstOrThrow({ where: { code: sc } })).isActive, false);
    const audits = await prisma.auditLog.findMany({ where: { action: "FRANCHISE_LOCATIONS_IMPORTED", actorId: people.admA.id, target: { in: [p1.body.fileSha256, p2.body.fileSha256] } } });
    assert.equal(audits.length, 2);
    assert.deepEqual((audits[0].metadata as { fileSha256?: string; createdDisabled?: boolean }).createdDisabled, true);
  });
});

describe("privacy notice acceptance (server-side, versioned, append-only)", () => {
  const acceptances = (userId: string) => prisma.franchisePrivacyNoticeAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: "asc" } });

  test("no acceptance → refused before any upload, and nothing is stored", async () => {
    const u = await makeUser("pnMissing");
    const before = store.size;
    for (const over of [{ privacyNoticeAccepted: undefined }, { privacyNoticeAccepted: "false" }, { privacyNoticeAccepted: "on" }, { privacyNoticeAccepted: "TRUE" }, { privacyNoticeAccepted: "" }]) {
      const r = await apply(u, fields(over));
      assert.deepEqual([r.status, r.body.code], [400, "PRIVACY_NOTICE_NOT_ACCEPTED"], JSON.stringify(over));
    }
    assert.equal(store.size, before, "no document was uploaded");
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 0);
    assert.equal((await acceptances(u.id)).length, 0);
  });

  test("nothing else stands in for privacy consent", async () => {
    const u = await makeUser("pnRefundOnly");
    const r = await apply(u, fields({ privacyNoticeAccepted: undefined, privacyNoticeVersion: undefined, privacyNoticeSha256: undefined }));
    assert.deepEqual([r.status, r.body.code], [400, "PRIVACY_NOTICE_NOT_ACCEPTED"]);
  });

  test("a wrong version or a different text hash is refused with the current notice", async () => {
    const u = await makeUser("pnWrong");
    for (const over of [{ privacyNoticeVersion: String(privacy.version + 1) }, { privacyNoticeVersion: "abc" }, { privacyNoticeVersion: undefined }, { privacyNoticeSha256: "0".repeat(64) }, { privacyNoticeSha256: undefined }]) {
      const r = await apply(u, fields(over));
      assert.deepEqual([r.status, r.body.code], [409, "PRIVACY_NOTICE_CHANGED"], JSON.stringify(over));
      assert.equal(r.body.privacyNotice.sha256, privacy.sha256);
    }
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 0);
  });

  let accepted: { user: U; applicationId: string; policyVersionId: string; sha: string; version: number } | null = null;

  test("a valid acceptance is recorded with the application: version, hash, user, application, UTC time, explicit method", async () => {
    const u = await makeUser("pnValid");
    const t0 = Date.now();
    const r = await apply(u, fields({ districtId: loc.d2 }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rows = await acceptances(u.id);
    assert.equal(rows.length, 1);
    const [row] = rows;
    const info = await call("GET", "/franchise/info", null);
    assert.equal(row.applicationId, r.body.id);
    assert.equal(row.userId, u.id);
    assert.equal(row.noticeVersion, privacy.version);
    assert.equal(row.noticeSha256, privacy.sha256);
    assert.equal(row.policyVersionId, info.body.policy.id);
    assert.equal(row.method, "EXPLICIT_CHECKBOX");
    assert.ok(row.acceptedAt.getTime() >= t0 - 1000 && row.acceptedAt.getTime() <= Date.now() + 1000, "server time of acceptance");
    // Nothing beyond the references and the evidence is stored (no IP, device or contact data).
    assert.deepEqual(Object.keys(row).sort(), ["acceptedAt", "applicationId", "id", "method", "noticeSha256", "noticeVersion", "policyVersionId", "userId"]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "FRANCHISE_APPLICATION_SUBMITTED", target: r.body.id } });
    assert.equal((audit.metadata as { privacyNoticeVersion?: number }).privacyNoticeVersion, privacy.version);
    accepted = { user: u, applicationId: r.body.id, policyVersionId: row.policyVersionId, sha: row.noticeSha256, version: row.noticeVersion };
  });

  test("a duplicate submission is refused and records no second acceptance", async () => {
    assert.ok(accepted, "previous test recorded an acceptance");
    const r = await apply(accepted.user, fields({ districtId: loc.d2 }));
    assert.deepEqual([r.status, r.body.code], [409, "APPLICATION_EXISTS"]);
    assert.equal((await acceptances(accepted.user.id)).length, 1);
  });

  test("acceptance rows can't be changed or deleted, and malformed evidence is refused (database guards)", async () => {
    assert.ok(accepted);
    const row = (await acceptances(accepted.user.id))[0];
    await assert.rejects(prisma.franchisePrivacyNoticeAcceptance.update({ where: { id: row.id }, data: { noticeVersion: 999 } }), /append-only/);
    await assert.rejects(prisma.franchisePrivacyNoticeAcceptance.delete({ where: { id: row.id } }), /append-only/);
    await assert.rejects(
      prisma.franchisePrivacyNoticeAcceptance.create({ data: { applicationId: accepted.applicationId, userId: accepted.user.id, policyVersionId: accepted.policyVersionId, noticeVersion: 1, noticeSha256: "not-a-hash" } }),
      /evidence_check|violates check constraint/
    );
  });

  test("a new notice version keeps the old acceptance and the old wording intact; the old version is then refused", async () => {
    assert.ok(accepted);
    const NEW_TEXT = `${PRIVACY_TEXT} Revised.`;
    await publishCommercial({ applicationIntake: "OPEN", documentRequirements: DOCS, privacyNotice: { text: NEW_TEXT } });
    const info = await call("GET", "/franchise/info", null);
    assert.ok(info.body.privacyNotice.version > accepted.version, "a newer version is published");
    assert.notEqual(info.body.privacyNotice.sha256, accepted.sha);
    // The earlier acceptance still points at the version (and exact wording) that was accepted.
    const [old] = await acceptances(accepted.user.id);
    assert.deepEqual([old.noticeVersion, old.noticeSha256, old.policyVersionId], [accepted.version, accepted.sha, accepted.policyVersionId]);
    const oldPolicy = await prisma.policyVersion.findUniqueOrThrow({ where: { id: accepted.policyVersionId } });
    assert.equal(createHash("sha256").update((oldPolicy.payload as { privacyNotice: { text: string } }).privacyNotice.text).digest("hex"), accepted.sha);
    // Submitting against the superseded notice is refused...
    const u = await makeUser("pnStale");
    const current = {};
    const stale = await apply(u, fields({ ...current, districtId: loc.d3 }));
    assert.deepEqual([stale.status, stale.body.code], [409, "PRIVACY_NOTICE_CHANGED"]);
    // ...and the current one is accepted, as a new row for that application.
    const ok = await apply(u, fields({ ...current, privacyNoticeVersion: String(info.body.privacyNotice.version), privacyNoticeSha256: info.body.privacyNotice.sha256, districtId: loc.d3 }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const [fresh] = await acceptances(u.id);
    assert.deepEqual([fresh.noticeVersion, fresh.noticeSha256], [info.body.privacyNotice.version, info.body.privacyNotice.sha256]);
    // Keep the shared fixtures pointing at the notice now in force for any later test.
    privacy = info.body.privacyNotice;
  });
});

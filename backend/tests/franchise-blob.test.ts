/**
 * Franchise documents against a REAL Blob store — the isolated test store only. Skipped unless BOTH:
 *   1. this run is pinned to a positively identified test store (tests/blob-test-store.ts), and
 *   2. FRANCHISE_REAL_BLOB_TEST=1 is set — the explicit, per-run approval for this suite.
 * The real storage module is wrapped only to count uploads/deletes and to inject one failure; every
 * call still goes to the test store. Everything it creates is deleted and the deletion verified.
 * Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { list } from "@vercel/blob";
import { assertRealBlobAllowed, blobTestMode, describeStore, realBlobSkip } from "./blob-test-store.js";

const real = await import("../src/services/storage.service.js");
const ledger = { uploaded: [] as string[], uploadFailures: 0, deletedByService: [] as string[], deletedByTeardown: [] as string[] };
let failNthUpload = Infinity; // fail the Nth upload from now (1-based)
let uploadsSinceArm = 0;
let teardown = false;
mock.module("../src/services/storage.service.js", {
  namedExports: {
    ...real,
    uploadBuffer: async (key: string, body: Buffer, contentType: string, options?: { allowOverwrite?: boolean }) => {
      uploadsSinceArm += 1;
      if (uploadsSinceArm === failNthUpload) {
        ledger.uploadFailures += 1;
        throw new Error("injected upload failure (test)");
      }
      await real.uploadBuffer(key, body, contentType, options);
      ledger.uploaded.push(key);
    },
    deleteObject: async (key: string, store?: "private" | "public") => {
      await real.deleteObject(key, store);
      (teardown ? ledger.deletedByTeardown : ledger.deletedByService).push(key);
    },
  },
});
const { prisma } = await import("../src/config/prisma.js");
const { APPROVED_STARTING_VALUES } = await import("../src/services/policy-schemas.js");
const { approvePublication, createDraft, submitForApproval } = await import("../src/services/policy.service.js");
const { intakeStatus, myDocumentUrl, submitApplication, MAX_DOCUMENT_BYTES } = await import("../src/services/franchise-application.service.js");
type UploadedFile = import("../src/services/franchise-application.service.js").UploadedFile;

const skip = realBlobSkip || (process.env.FRANCHISE_REAL_BLOB_TEST !== "1" ? "needs FRANCHISE_REAL_BLOB_TEST=1 (explicit approval for this run)" : false);
const tag = `zz-test-${randomBytes(4).toString("hex")}`;
const PREFIX = "franchise-applications/";
const KEY_SHAPE = /^franchise-applications\/fa[0-9a-f]{32}\/(id_proof|photo|address_proof|business_plan)-[0-9a-f]{16}\.(pdf|jpg|png)$/;
const userIds: string[] = [];
const loc = { stateId: "", districtId: "" };
let refund = { version: "", sha256: "" };
let baseline = new Set<string>();

const PDF = Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(256)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(256)]);
const part = (fieldname: string, buffer: Buffer, mimetype: string): UploadedFile => ({ fieldname, originalname: `${fieldname}.bin`, mimetype, size: buffer.length, buffer });
const files = () => [part("idProof", PDF, "application/pdf"), part("photo", JPG, "image/jpeg"), part("addressProof", PNG, "image/png")];
const body = () => ({ applicantName: "Blob Test", mobile: "9876543210", stateId: loc.stateId, districtId: loc.districtId, address: "1, Test Street, Test Town", refundPolicyVersion: refund.version, refundPolicySha256: refund.sha256 });
const sha = (b: Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");
const status = (code: number) => (e: { status?: number }) => e.status === code;
async function keysUnderPrefix() {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, token: process.env.BLOB_READ_WRITE_TOKEN });
    out.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
const newKeys = async () => (await keysUnderPrefix()).filter((k) => !baseline.has(k));
const arm = (n: number) => {
  uploadsSinceArm = 0;
  failNthUpload = n;
};

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `B${tag.slice(-8)}${userIds.length}`.toUpperCase(), role, emailVerified: new Date() },
  });
  userIds.push(u.id);
  return u;
}

describe("franchise documents on the isolated test Blob store", { skip }, () => {
  before(async () => {
    assertRealBlobAllowed();
    const [a, b] = [await makeUser("admA", "ADMIN"), await makeUser("admB", "ADMIN")];
    const payload = {
      ...APPROVED_STARTING_VALUES.COMMERCIAL,
      applicationIntake: "OPEN",
      documentRequirements: { PHOTO: "REQUIRED", ADDRESS_PROOF: "OPTIONAL", BUSINESS_PLAN: "OPTIONAL" },
      feeRefundPolicy: { text: `${tag}: test-only refund text for the isolated Blob test (local database only).` },
    };
    const draft = await createDraft({ domain: "COMMERCIAL", actorId: a.id, payload });
    const { request } = await submitForApproval({ id: draft.id, actorId: a.id, expectedSha: draft.payloadSha256, reason: "isolated Blob test (local database)" });
    await approvePublication({ requestId: request.id, approverId: b.id, expectedPayloadSha: request.payloadSha256 });
    const info = await intakeStatus();
    assert.equal(info.open, true, info.reasons.join("; "));
    refund = { version: String(info.refundPolicy!.version), sha256: info.refundPolicy!.sha256 };
    const state = await prisma.indiaState.create({ data: { name: `${tag} State`, isActive: true } });
    const district = await prisma.district.create({ data: { stateId: state.id, name: `${tag} District`, isActive: true } });
    Object.assign(loc, { stateId: state.id, districtId: district.id });
  });

  after(async () => {
    // Safety net: anything still present from this run is removed (normally the deletion test did it).
    teardown = true;
    for (const key of new Set(ledger.uploaded)) {
      if (!(await real.statObject(key))) continue;
      await real.deleteObject(key);
      ledger.deletedByTeardown.push(key);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL eta.financial_maintenance = 'on'`; // test cleanup only (logged)
      await tx.$executeRaw`SET LOCAL eta.maintenance_reason = 'franchise-blob test cleanup'`;
      const apps = (await tx.franchiseApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((x) => x.id);
      await tx.franchiseNotification.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationDocument.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplicationStatusHistory.deleteMany({ where: { applicationId: { in: apps } } });
      await tx.franchiseApplication.deleteMany({ where: { id: { in: apps } } });
      await tx.district.deleteMany({ where: { name: { startsWith: tag } } });
      await tx.indiaState.deleteMany({ where: { name: { startsWith: tag } } });
      const policies = (await tx.policyVersion.findMany({ where: { createdById: { in: userIds } }, select: { id: true } })).map((p) => p.id);
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { target: { in: [...policies, ...apps] } }] } });
      await tx.policyVersion.deleteMany({ where: { id: { in: policies } } });
      await tx.adminApprovalRequest.deleteMany({ where: { requestedById: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    console.log(`[franchise-blob] ledger ${JSON.stringify({ uploaded: ledger.uploaded.length, injectedFailures: ledger.uploadFailures, deletedByService: ledger.deletedByService.length, deletedByTeardown: ledger.deletedByTeardown.length })}`);
  });

  test("0. identity: the run is pinned to the isolated test store; baseline recorded before any upload", async (t) => {
    assertRealBlobAllowed();
    assert.equal(blobTestMode.kind, "test-store");
    const existing = await keysUnderPrefix();
    baseline = new Set(existing);
    t.diagnostic(`test store ${blobTestMode.kind === "test-store" ? describeStore(blobTestMode.storeId) : "?"}; objects under ${PREFIX} before the run: ${existing.length}`);
  });

  test("1. valid PDF, JPEG and PNG are stored with the detected type, exact size and bytes", async () => {
    const u = await makeUser("owner");
    const app = await submitApplication({ userId: u.id, body: body(), files: files() });
    const docs = await prisma.franchiseApplicationDocument.findMany({ where: { applicationId: app.id }, orderBy: { kind: "asc" } });
    assert.deepEqual(docs.map((d) => d.mimeType).sort(), ["application/pdf", "image/jpeg", "image/png"]);
    for (const d of docs) {
      const stat = await real.statObject(d.storageKey);
      assert.ok(stat, `${d.kind} stored`);
      assert.equal(stat.size, d.sizeBytes);
      assert.equal(stat.contentType, d.mimeType);
    }
    assert.deepEqual((await newKeys()).sort(), docs.map((d) => d.storageKey).sort());
  });

  test("2. invalid content and MIME mismatches are refused before anything is uploaded", async () => {
    const u = await makeUser("invalid");
    const before = ledger.uploaded.length;
    const keysBefore = (await newKeys()).length;
    await assert.rejects(submitApplication({ userId: u.id, body: body(), files: [part("idProof", Buffer.from("MZ\x90\x00 not a pdf"), "application/pdf"), part("photo", JPG, "image/jpeg")] }), status(415));
    await assert.rejects(submitApplication({ userId: u.id, body: body(), files: [part("idProof", PNG, "application/pdf"), part("photo", JPG, "image/jpeg")] }), status(415));
    await assert.rejects(submitApplication({ userId: u.id, body: body(), files: [part("idProof", PDF, "application/pdf"), part("photo", Buffer.from("<svg onload=alert(1)>"), "image/png")] }), status(415));
    assert.equal(ledger.uploaded.length, before);
    assert.equal((await newKeys()).length, keysBefore);
  });

  test("3. size limit: exactly 5 MB is accepted, 5 MB + 1 byte is refused before upload", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES - PDF.length, 0x20)]);
    assert.equal(big.length, MAX_DOCUMENT_BYTES);
    const tooBig = Buffer.concat([big, Buffer.from(" ")]);
    const refused = await makeUser("toobig");
    const before = ledger.uploaded.length;
    await assert.rejects(submitApplication({ userId: refused.id, body: body(), files: [part("idProof", tooBig, "application/pdf"), part("photo", JPG, "image/jpeg")] }), status(413));
    assert.equal(ledger.uploaded.length, before, "nothing uploaded for the oversized file");
    const ok = await makeUser("fivemb");
    const app = await submitApplication({ userId: ok.id, body: body(), files: [part("idProof", big, "application/pdf"), part("photo", JPG, "image/jpeg")] });
    const doc = await prisma.franchiseApplicationDocument.findFirstOrThrow({ where: { applicationId: app.id, kind: "ID_PROOF" } });
    assert.equal((await real.statObject(doc.storageKey))?.size, MAX_DOCUMENT_BYTES);
  });

  test("4. private access: a stored object can't be read without a signature", async () => {
    const doc = await prisma.franchiseApplicationDocument.findFirstOrThrow({ where: { application: { user: { username: `${tag}-owner` } }, kind: "ID_PROOF" } });
    const stat = await real.statObject(doc.storageKey);
    const unsigned = await fetch(stat!.url);
    assert.ok(unsigned.status === 401 || unsigned.status === 403, `unsigned read refused (got ${unsigned.status})`);
    const guessed = await fetch(stat!.url.replace(/\/[^/]+$/, "/guessed-name.pdf"));
    assert.notEqual(guessed.status, 200);
  });

  test("5 + 6. owner-only signed links return the exact bytes and stop working after 65 seconds", { timeout: 150_000 }, async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { username: `${tag}-owner` } });
    const doc = await prisma.franchiseApplicationDocument.findFirstOrThrow({ where: { uploadedById: owner.id, kind: "ID_PROOF" } });
    const other = await makeUser("other");
    await assert.rejects(myDocumentUrl(other.id, doc.id), status(404));
    const admin = await prisma.user.findFirstOrThrow({ where: { username: `${tag}-admA` } });
    await assert.rejects(myDocumentUrl(admin.id, doc.id), status(404));
    const { url, expiresInSeconds } = await myDocumentUrl(owner.id, doc.id);
    assert.equal(expiresInSeconds, 60);
    const ok = await fetch(url);
    assert.equal(ok.status, 200);
    assert.equal(sha(new Uint8Array(await ok.arrayBuffer())), doc.sha256);
    const tampered = await fetch(url.replace(/([?&][^=]*sig[^=]*=)([^&]+)/i, (_m, k: string, v: string) => `${k}${v.slice(0, -2)}xx`));
    assert.notEqual(tampered.status, 200, "a tampered link is refused");
    await new Promise((r) => setTimeout(r, 65_000));
    const expired = await fetch(url);
    assert.notEqual(expired.status, 200, `expired link refused (got ${expired.status})`);
  });

  test("7. duplicate concurrent submissions: one wins and only the winner's files remain", async () => {
    const u = await makeUser("racer");
    const before = new Set(await newKeys());
    const results = await Promise.allSettled([submitApplication({ userId: u.id, body: body(), files: files() }), submitApplication({ userId: u.id, body: body(), files: files() })]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;
    const added = (await newKeys()).filter((k) => !before.has(k));
    assert.equal(added.length, 3, "exactly the winner's three documents");
    assert.ok(added.every((k) => k.startsWith(`${PREFIX}${winner.id}/`)));
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 1);
  });

  test("8. partial upload failure: the documents already uploaded are deleted and nothing is saved", async () => {
    const u = await makeUser("partial");
    const before = new Set(await newKeys());
    const uploadedBefore = ledger.uploaded.length;
    arm(3);
    try {
      await assert.rejects(submitApplication({ userId: u.id, body: body(), files: files() }), status(503));
    } finally {
      failNthUpload = Infinity;
    }
    const partial = ledger.uploaded.slice(uploadedBefore);
    assert.equal(partial.length, 2, "two documents reached the store before the failure");
    for (const key of partial) {
      assert.ok(ledger.deletedByService.includes(key), "removed by the service's cleanup");
      assert.equal(await real.statObject(key), null, "and really gone from the store");
    }
    assert.deepEqual((await newKeys()).filter((k) => !before.has(k)), []);
    assert.equal(await prisma.franchiseApplication.count({ where: { userId: u.id } }), 0);
  });

  test("9. storage keys are unique, unguessable and can't be overwritten", async () => {
    const keys = ledger.uploaded;
    assert.equal(new Set(keys).size, keys.length, "no key reused");
    for (const k of keys) assert.match(k, KEY_SHAPE);
    const doc = await prisma.franchiseApplicationDocument.findFirstOrThrow({ where: { application: { user: { username: `${tag}-owner` } }, kind: "PHOTO" } });
    const sizeBefore = (await real.statObject(doc.storageKey))!.size;
    await assert.rejects(real.uploadBuffer(doc.storageKey, Buffer.from("replacement"), "image/jpeg", { allowOverwrite: false }));
    assert.equal((await real.statObject(doc.storageKey))!.size, sizeBefore, "the stored document is unchanged");
    const owner = await prisma.user.findFirstOrThrow({ where: { username: `${tag}-owner` } });
    const { url } = await myDocumentUrl(owner.id, doc.id);
    assert.equal(sha(new Uint8Array(await (await fetch(url)).arrayBuffer())), doc.sha256, "bytes still match the recorded hash");
  });

  test("10. deletion: every object this run created is deleted and verified gone; nothing else is touched", async (t) => {
    teardown = true;
    // Only keys this run uploaded (recorded at upload time) are ever deleted.
    for (const key of ledger.uploaded) {
      if (ledger.deletedByService.includes(key)) continue;
      await real.deleteObject(key);
      ledger.deletedByTeardown.push(key);
    }
    for (const key of ledger.uploaded) assert.equal(await real.statObject(key), null, `${key} is gone`);
    const foreign = await newKeys();
    assert.deepEqual(foreign, [], "no other new objects appeared under the prefix during the run (reported, never deleted)");
    t.diagnostic(`uploaded ${ledger.uploaded.length}; deleted by service cleanup ${ledger.deletedByService.length}; deleted by teardown ${ledger.deletedByTeardown.length}; injected failures ${ledger.uploadFailures}; remaining 0`);
    assert.equal(ledger.deletedByService.length + ledger.deletedByTeardown.length, ledger.uploaded.length, "every uploaded object was deleted exactly once");
  });
});

/**
 * Company legal documents: admin management, customer access to published PDFs only, and the
 * guards around both. Rows are inserted directly where no file is needed; the upload round-trip
 * writes real files, so it runs ONLY with TEST_BLOB_READ_WRITE_TOKEN for a separate (test) store and
 * refuses the main store, which is shared with production. Everything is prefixed "zz-test-".
 */
import "./local-db-guard.js"; // first: refuses to run against a non-local (production) database
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { statObject, uploadBuffer } from "../src/services/storage.service.js";

const tag = `zz-test-${randomBytes(4).toString("hex")}`;
let server: Server;
let base = "";
const ids = { users: [] as string[], course: "" };
const tokens = { admin: "", customer: "", noPurchase: "" };
let publishedId = "";
let draftId = "";

async function makeUser(name: string, role: "USER" | "ADMIN" = "USER") {
  const u = await prisma.user.create({
    data: { name, email: `${tag}-${name}@example.test`, username: `${tag}-${name}`, passwordHash: "x", referralCode: `${tag}-${name}`, role },
  });
  ids.users.push(u.id);
  return { id: u.id, token: signSessionToken({ id: u.id, name, email: u.email, role, referralCode: u.referralCode }, u.passwordHash) };
}

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

const doc = (title: string, isPublished: boolean) =>
  prisma.legalDocument.create({
    data: { title, type: "GST_REGISTRATION", fileName: `${title}.pdf`, storageKey: `legal-documents/${tag}-${title}.pdf`, sizeBytes: 2048n, isPublished, publishedAt: isPublished ? new Date() : null },
  });

const audits = (target: string) => prisma.auditLog.findMany({ where: { target }, select: { action: true } }).then((r) => r.map((a) => a.action));

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const course = await prisma.course.create({
    data: { slug: `${tag}-pkg`, type: "VIDEO", title: `${tag} package`, shortDescription: "t", description: "t", priceInPaise: 100, commissionInPaise: 0 },
  });
  ids.course = course.id;
  tokens.admin = (await makeUser("admin", "ADMIN")).token;
  const customer = await makeUser("customer");
  tokens.customer = customer.token;
  tokens.noPurchase = (await makeUser("no-purchase")).token;
  const order = await prisma.order.create({ data: { userId: customer.id, courseId: course.id, amountInPaise: 100, status: "PAID", razorpayOrderId: `${tag}-order`, paidAt: new Date() } });
  await prisma.courseAccess.create({ data: { userId: customer.id, courseId: course.id, orderId: order.id } });

  publishedId = (await doc("published", true)).id;
  draftId = (await doc("draft", false)).id;
});

after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.users } } });
  await prisma.legalDocument.deleteMany({ where: { storageKey: { startsWith: `legal-documents/${tag}` } } });
  await prisma.courseAccess.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.order.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  server.close();
});

test("customers see published documents only, without storage details", async () => {
  const res = await call("GET", "/me/legal-documents", tokens.customer);
  assert.equal(res.status, 200, res.raw);
  const titles = res.body.documents.map((d: { title: string }) => d.title);
  assert.ok(titles.includes("published"));
  assert.ok(!titles.includes("draft"), "unpublished documents are never listed");
  const published = res.body.documents.find((d: { id: string }) => d.id === publishedId);
  assert.deepEqual(Object.keys(published).sort(), ["description", "id", "sizeBytes", "title", "type", "updatedAt"]);
  assert.ok(!res.raw.includes("legal-documents/") && !res.raw.includes("storageKey"), "storage keys never reach customers");
});

test("customers open a published document through a short-lived link; unpublished or unknown IDs get nothing", async () => {
  const dl = await call("POST", `/me/legal-documents/${publishedId}/download`, tokens.customer);
  assert.equal(dl.status, 200, dl.raw);
  assert.match(dl.body.url, /^https:\/\//);
  assert.equal(dl.body.fileName, "published.pdf");
  const ttl = new Date(dl.body.expiresAt).getTime() - Date.now();
  assert.ok(ttl > 0 && ttl <= 5 * 60_000 + 5000, "link must expire within 5 minutes");

  for (const id of [draftId, "no-such-document"]) {
    const res = await call("POST", `/me/legal-documents/${id}/download`, tokens.customer);
    assert.equal(res.status, 404, `${id}: ${res.raw}`);
    assert.ok(!res.raw.includes("https://"), "no link of any kind");
  }
});

test("the documents need a signed-in customer with a purchase, like the dashboard", async () => {
  assert.equal((await call("GET", "/me/legal-documents", null)).status, 401);
  assert.equal((await call("POST", `/me/legal-documents/${publishedId}/download`, null)).status, 401);
  const noPurchase = await call("GET", "/me/legal-documents", tokens.noPurchase);
  assert.equal(noPurchase.status, 403);
  assert.equal(noPurchase.body.code, "NO_COURSE_ACCESS");
  assert.equal((await call("POST", `/me/legal-documents/${publishedId}/download`, tokens.noPurchase)).status, 403);
});

test("every admin endpoint refuses customers and signed-out callers, and nothing changes", async () => {
  const before = await prisma.legalDocument.findMany({ where: { storageKey: { startsWith: `legal-documents/${tag}` } }, orderBy: { id: "asc" } });
  const endpoints: [string, string, unknown?][] = [
    ["GET", "/admin/legal-documents"],
    ["POST", "/admin/legal-documents/upload-token", { filename: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }],
    ["POST", "/admin/legal-documents", { title: "Hack", type: "OTHER", storageKey: `legal-documents/${tag}-x.pdf`, fileName: "x.pdf" }],
    ["PATCH", `/admin/legal-documents/${draftId}`, { isPublished: true }],
    ["DELETE", `/admin/legal-documents/${publishedId}`],
    ["POST", "/admin/legal-documents/discard-upload", { key: `legal-documents/${tag}-published.pdf` }],
    ["GET", `/admin/legal-documents/${draftId}/preview`],
  ];
  for (const [method, path, body] of endpoints) {
    for (const [label, token, expected] of [["customer", tokens.customer, 403], ["signed out", null, 401]] as const) {
      const res = await call(method, path, token, body);
      assert.equal(res.status, expected, `${label} → ${method} ${path}: ${res.raw}`);
      assert.ok(!res.raw.includes("legal-documents/") && !res.raw.includes("https://"), `${label} → ${method} ${path} leaked data`);
    }
  }
  const afterRows = await prisma.legalDocument.findMany({ where: { storageKey: { startsWith: `legal-documents/${tag}` } }, orderBy: { id: "asc" } });
  assert.deepEqual(afterRows, before);
});

test("admins list every document, including hidden ones, and can preview them", async () => {
  const res = await call("GET", "/admin/legal-documents", tokens.admin);
  assert.equal(res.status, 200, res.raw);
  const draft = res.body.documents.find((d: { id: string }) => d.id === draftId);
  assert.equal(draft.isPublished, false);
  assert.equal(draft.fileName, "draft.pdf");
  assert.ok(draft.updatedAt, "shows the last-updated date");
  assert.match((await call("GET", `/admin/legal-documents/${draftId}/preview`, tokens.admin)).body.url, /^https:\/\//);
  assert.equal((await call("GET", "/admin/legal-documents/no-such-document/preview", tokens.admin)).status, 404);
});

test("invalid files, sizes and fields are refused before anything is stored", async () => {
  const token = (body: object) => call("POST", "/admin/legal-documents/upload-token", tokens.admin, body);
  assert.equal((await token({ filename: "a.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 10 })).status, 400, "Word files");
  assert.equal((await token({ filename: "a.exe", contentType: "application/pdf", sizeBytes: 10 })).status, 400, "wrong extension");
  assert.equal((await token({ filename: "a.pdf", contentType: "application/epub+zip", sizeBytes: 10 })).status, 400, "wrong type");
  assert.equal((await token({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 20 * 1024 ** 2 + 1 })).status, 400, "over 20 MB");
  assert.equal((await token({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 0 })).status, 400, "empty");

  const create = (body: object) => call("POST", "/admin/legal-documents", tokens.admin, { title: "GST certificate", type: "GST_REGISTRATION", storageKey: `legal-documents/${tag}-new.pdf`, fileName: "new.pdf", ...body });
  assert.equal((await create({ type: undefined })).status, 400, "type is required");
  assert.equal((await create({ type: "PASSPORT" })).status, 400, "unknown type");
  assert.equal((await create({ title: "x" })).status, 400, "title too short");
  assert.equal((await create({ storageKey: "ebooks/someone-elses.pdf" })).status, 400, "only this feature's uploads");
  assert.equal((await create({ storageKey: "course-videos/x.mp4" })).status, 400);
  assert.equal(await prisma.legalDocument.count({ where: { storageKey: `legal-documents/${tag}-new.pdf` } }), 0);

  const discard = await call("POST", "/admin/legal-documents/discard-upload", tokens.admin, { key: `legal-documents/${tag}-published.pdf` });
  assert.equal(discard.status, 409, "a saved document's file can't be discarded");
  assert.equal((await call("POST", "/admin/legal-documents/discard-upload", tokens.admin, { key: "ebooks/x.pdf" })).status, 400);
});

test("admins publish, unpublish and edit; customers see each change; every action is audited", async () => {
  const titles = async () => (await call("GET", "/me/legal-documents", tokens.customer)).body.documents.map((d: { title: string }) => d.title);
  const updatedBefore = (await prisma.legalDocument.findUniqueOrThrow({ where: { id: draftId } })).updatedAt;

  const pub = await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { isPublished: true });
  assert.equal(pub.status, 200, pub.raw);
  assert.ok(pub.body.document.publishedAt, "publishing records when");
  assert.ok((await titles()).includes("draft"));
  assert.equal((await call("POST", `/me/legal-documents/${draftId}/download`, tokens.customer)).status, 200);

  assert.equal((await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { isPublished: false })).status, 200);
  assert.ok(!(await titles()).includes("draft"), "unpublished documents disappear for customers");
  assert.equal((await call("POST", `/me/legal-documents/${draftId}/download`, tokens.customer)).status, 404, "and can't be opened");

  const edited = await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { title: "MSME certificate", type: "MSME_UDYAM", description: "Udyam registration" });
  assert.equal(edited.status, 200, edited.raw);
  assert.equal(edited.body.document.type, "MSME_UDYAM");
  assert.equal(edited.body.document.description, "Udyam registration");
  assert.ok(new Date(edited.body.document.updatedAt) > updatedBefore, "last-updated moves on");

  assert.equal((await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { type: "PASSPORT" })).status, 400);
  assert.equal((await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { storageKey: `legal-documents/${tag}-other.pdf` })).status, 400, "a replacement needs its file name");
  assert.equal((await call("PATCH", `/admin/legal-documents/${draftId}`, tokens.admin, { storageKey: "ebooks/x.pdf", fileName: "x.pdf" })).status, 400);
  assert.equal((await call("PATCH", "/admin/legal-documents/no-such-document", tokens.admin, { title: "Nothing here" })).status, 404);

  assert.deepEqual((await audits(draftId)).sort(), ["LEGAL_DOCUMENT_PUBLISHED", "LEGAL_DOCUMENT_UNPUBLISHED", "LEGAL_DOCUMENT_UPDATED"]);
});

test("admins delete a document; customers lose it at once", async () => {
  const doomed = (await doc("to-delete", true)).id;
  const res = await call("DELETE", `/admin/legal-documents/${doomed}`, tokens.admin);
  assert.equal(res.status, 200, res.raw);
  assert.equal(await prisma.legalDocument.count({ where: { id: doomed } }), 0);
  assert.equal((await call("POST", `/me/legal-documents/${doomed}/download`, tokens.customer)).status, 404);
  assert.deepEqual(await audits(doomed), ["LEGAL_DOCUMENT_DELETED"]);
  assert.equal((await call("DELETE", `/admin/legal-documents/${doomed}`, tokens.admin)).status, 404);
});

test("upload, reject a fake PDF, replace and delete (Blob round-trip)", { skip: !process.env.TEST_BLOB_READ_WRITE_TOKEN && "needs an isolated store: set TEST_BLOB_READ_WRITE_TOKEN" }, async () => {
  const storeOf = (token = "") => /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1] ?? null;
  const testStore = storeOf(process.env.TEST_BLOB_READ_WRITE_TOKEN);
  assert.ok(testStore, "TEST_BLOB_READ_WRITE_TOKEN isn't a Blob read-write token");
  assert.notEqual(testStore, storeOf(process.env.BLOB_READ_WRITE_TOKEN), "refusing to write: the test token points at the main (production) store");
  const mainToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = process.env.TEST_BLOB_READ_WRITE_TOKEN;
  try {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const [k1, k2, fake] = ["one", "two", "fake"].map((n) => `legal-documents/${tag}-${n}.pdf`);
    await uploadBuffer(k1, pdf, "application/pdf");
    await uploadBuffer(k2, pdf, "application/pdf");
    await uploadBuffer(fake, Buffer.from("<html>not a pdf</html>"), "application/pdf");

    const bad = await call("POST", "/admin/legal-documents", tokens.admin, { title: "Fake", type: "OTHER", storageKey: fake, fileName: "fake.pdf" });
    assert.equal(bad.status, 400, bad.raw);
    assert.equal(await statObject(fake), null, "a rejected upload is deleted from storage");

    const created = await call("POST", "/admin/legal-documents", tokens.admin, { title: "Round trip", type: "COMPANY_REGISTRATION", storageKey: k1, fileName: "one.pdf" });
    assert.equal(created.status, 201, created.raw);
    const id = created.body.document.id;
    assert.equal(created.body.document.isPublished, false, "new uploads stay hidden until published");

    const replaced = await call("PATCH", `/admin/legal-documents/${id}`, tokens.admin, { storageKey: k2, fileName: "two.pdf", isPublished: true });
    assert.equal(replaced.status, 200, replaced.raw);
    assert.equal(await statObject(k1), null, "the replaced file is deleted");

    const dl = await call("POST", `/me/legal-documents/${id}/download`, tokens.customer);
    assert.equal(dl.status, 200);
    assert.ok((await (await fetch(dl.body.url)).text()).startsWith("%PDF"));

    assert.equal((await call("DELETE", `/admin/legal-documents/${id}`, tokens.admin)).status, 200);
    assert.equal(await statObject(k2), null, "the deleted document's file is removed");
  } finally {
    process.env.BLOB_READ_WRITE_TOKEN = mainToken;
  }
});

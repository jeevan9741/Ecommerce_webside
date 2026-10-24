/**
 * PAID_ACCESS on the course-certificate endpoints. Belongs with the certificate feature (commit it
 * together with certificate.controller/service). Fixture: paid-access.fixture.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/config/prisma.js";
import { signSessionToken } from "../src/utils/tokens.js";
import { accessMatrix, call, categoryVideoId, courseId, packageVideoId, tag, tokens, useFixture, type Surface } from "./paid-access.fixture.js";

useFixture();

const SURFACES: Surface[] = [
  ["certificate panel (GET /me/courses/:id/certificate)", async (t) => (await call("GET", `/me/courses/${courseId}/certificate`, t)).status === 200],
  ["certificate progress list (GET /me/certificates)", async (t) =>
    (await call("GET", "/me/certificates", t)).body.courses.some((c: { courseId: string }) => c.courseId === courseId)],
];

accessMatrix("only a PAID order with live access unlocks certificates", SURFACES);

const userIdOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).id as string;

/** Marks both of the fixture package's lessons completed for this user, as if they'd watched them. */
async function completeLessons(token: string) {
  const userId = userIdOf(token);
  for (const videoId of [packageVideoId, categoryVideoId]) {
    await prisma.videoProgress.upsert({
      where: { userId_videoId: { userId, videoId } },
      update: { completed: true, completedAt: new Date() },
      create: { userId, videoId, completed: true, completedAt: new Date() },
    });
  }
}

test("certificates: earned only by a paid buyer who completed every lesson; owner, admin and public views", async () => {
  // Not complete yet: refused, and the server reports the real progress.
  const early = await call("POST", `/me/courses/${courseId}/certificate`, tokens.paid);
  assert.equal(early.status, 400, early.raw);
  assert.equal(early.body.code, "COURSE_INCOMPLETE");

  // Finished lessons never unlock a certificate without a live PAID order.
  for (const name of ["pending", "refunded", "cancelledUnrevoked", "pendingWithStrayAccess"] as const) {
    await completeLessons(tokens[name]);
    const res = await call("POST", `/me/courses/${courseId}/certificate`, tokens[name]);
    assert.equal(res.status, 403, `${name}: ${res.raw}`);
  }

  await completeLessons(tokens.paid);
  const claimed = await call("POST", `/me/courses/${courseId}/certificate`, tokens.paid);
  assert.equal(claimed.status, 201, claimed.raw);
  const { certificateNo, id } = claimed.body.certificate as { certificateNo: string; id: string };
  assert.match(certificateNo, /^ECA-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await call("POST", `/me/courses/${courseId}/certificate`, tokens.paid)).body.certificate.certificateNo, certificateNo, "claiming twice returns the same certificate");

  // Only its owner (or an admin) can open the full certificate.
  assert.equal((await call("GET", `/me/certificates/${certificateNo}`, tokens.paid)).status, 200);
  assert.equal((await call("GET", `/me/certificates/${certificateNo}`, tokens.pending)).status, 404, "another student can't read it");
  assert.equal((await call("GET", `/me/certificates/${certificateNo}`, "")).status, 401);

  // Admin management is admin-only.
  for (const [method, path, body] of [
    ["GET", "/admin/course-certificates", undefined],
    ["POST", `/admin/course-certificates/${id}/revoke`, { reason: "testing" }],
    ["PUT", "/admin/certificate-settings", { name: "X Y", title: "Z Z" }],
  ] as const) {
    assert.equal((await call(method, path, tokens.paid, body)).status, 403, `student: ${method} ${path}`);
    assert.equal((await call(method, path, "", body)).status, 401, `signed out: ${method} ${path}`);
  }

  // Public verification shows the certificate but nothing that identifies the account.
  const pub = await call("GET", `/public/certificates/${certificateNo.toLowerCase()}`, "");
  assert.equal(pub.status, 200, pub.raw);
  assert.equal(pub.body.certificate.status, "VALID");
  for (const hidden of ["id", "courseId", "userId", "email"]) assert.equal(hidden in pub.body.certificate, false, `public view leaks ${hidden}`);
  assert.equal((await call("GET", "/public/certificates/ECA-2026-ZZZZZZ", "")).status, 404);

  // An admin can see and revoke it, and the public page then says so.
  const admin = await prisma.user.create({
    data: { name: "Admin", email: `${tag}-admin@example.test`, username: `${tag}-admin`, passwordHash: "x", referralCode: `${tag}-admin`, role: "ADMIN" },
  });
  try {
    const adminToken = signSessionToken({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", referralCode: admin.referralCode }, admin.passwordHash);
    assert.equal((await call("GET", `/me/certificates/${certificateNo}`, adminToken)).status, 200);
    assert.equal((await call("POST", `/admin/course-certificates/${id}/revoke`, adminToken, { reason: "issued in error" })).status, 200);
    assert.equal((await call("GET", `/public/certificates/${certificateNo}`, "")).body.certificate.status, "REVOKED");
  } finally {
    await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
    await prisma.user.delete({ where: { id: admin.id } });
  }
});

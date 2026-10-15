/**
 * The PAID_ACCESS rule across every paid-content endpoint in this release (dashboard, catalogue
 * "owned" list, course content, package and category videos, e-books, live classes): only a live
 * access row backed by a PAID order unlocks anything. Fixture: paid-access.fixture.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessMatrix, call, categorySlug, categoryVideoId, courseId, packageVideoId, tokens, useFixture, type Surface } from "./paid-access.fixture.js";

useFixture();

const SURFACES: Surface[] = [
  ["dashboard gate (GET /me/dashboard)", async (t) => (await call("GET", "/me/dashboard", t)).status === 200],
  ["owned list on the catalogue (GET /courses)", async (t) => (await call("GET", "/courses", t)).body.ownedCourseIds.includes(courseId)],
  ["my courses (GET /me/courses)", async (t) => {
    const r = await call("GET", "/me/courses", t);
    return r.status === 200 && r.body.access.some((a: { courseId: string }) => a.courseId === courseId);
  }],
  ["course page (GET /me/courses/:id)", async (t) => (await call("GET", `/me/courses/${courseId}`, t)).status === 200],
  ["course content (GET /courses/:id/content)", async (t) => (await call("GET", `/courses/${courseId}/content`, t)).status === 200],
  ["package video list (GET /me/courses/:id/videos)", async (t) => (await call("GET", `/me/courses/${courseId}/videos`, t)).status === 200],
  ["watch a package video (GET /me/videos/:id)", async (t) => (await call("GET", `/me/videos/${packageVideoId}`, t)).status === 200],
  ["watch a category video (GET /me/videos/:id)", async (t) => (await call("GET", `/me/videos/${categoryVideoId}`, t)).status === 200],
  ["save progress (PUT /me/videos/:id/progress)", async (t) => (await call("PUT", `/me/videos/${packageVideoId}/progress`, t, { positionSeconds: 1 })).status === 200],
  ["category library (GET /me/categories/:slug)", async (t) => (await call("GET", `/me/categories/${categorySlug}`, t)).body.category.locked === false],
  ["e-books for the package (GET /me/ebooks?courseId)", async (t) => (await call("GET", `/me/ebooks?courseId=${courseId}`, t)).status === 200],
  ["live classes for the package (GET /me/live-sessions?courseId)", async (t) => (await call("GET", `/me/live-sessions?courseId=${courseId}`, t)).status === 200],
];

accessMatrix("only a PAID order with live access unlocks paid content", SURFACES);

test("checkout still refuses a second purchase by the paid buyer (before any Razorpay call)", async () => {
  const r = await call("POST", "/checkout/create-order", tokens.paid, { courseId });
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.code, "ALREADY_PURCHASED");
});

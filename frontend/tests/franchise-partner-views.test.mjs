// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { listQuery, pageCount, progressLabel, PROGRESS_UNAVAILABLE } from "../lib/franchise-partner-views.ts";

test("progress is shown only from real data; missing data says so instead of guessing", () => {
  assert.equal(progressLabel({ available: true, completedLessons: 1, totalLessons: 2, percent: 50, isComplete: false }), "1 of 2 lessons · 50%");
  assert.equal(progressLabel({ available: true, completedLessons: 0, totalLessons: 1, percent: 0, isComplete: false }), "0 of 1 lesson · 0%");
  assert.equal(progressLabel({ available: true, completedLessons: 2, totalLessons: 2, percent: 100, isComplete: true }), "Completed · 2 of 2 lessons");
  for (const bad of [
    { available: false, completedLessons: null, totalLessons: null, percent: null, isComplete: null },
    { available: true, completedLessons: null, totalLessons: 2, percent: 50, isComplete: false },
    { available: true, completedLessons: 1, totalLessons: 2, percent: null, isComplete: false },
  ]) {
    assert.equal(progressLabel(bad), PROGRESS_UNAVAILABLE);
  }
  assert.equal(PROGRESS_UNAVAILABLE, "Progress data unavailable");
});

test("page counts never drop below one", () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageCount(10, 0), 1);
  assert.equal(pageCount(NaN, 25), 1);
});

test("list requests carry only a search text and a page", () => {
  assert.equal(listQuery("", 1), "");
  assert.equal(listQuery("  asha ", 1), "?q=asha");
  assert.equal(listQuery("a&b=c", 3), "?q=a%26b%3Dc&page=3");
  assert.equal(listQuery("", 2), "?page=2");
});

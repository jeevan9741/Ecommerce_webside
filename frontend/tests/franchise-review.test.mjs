// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION, REVIEW_STATUSES, STATUS_LABEL, isReviewAction, listQuery, pageCount, rejectionReasonError, statusTone } from "../lib/franchise-review.ts";

test("every status has a label; only the four review moves are actions", () => {
  for (const s of REVIEW_STATUSES) assert.ok(STATUS_LABEL[s], s);
  assert.deepEqual(Object.keys(ACTION).sort(), ["APPROVED", "INTERVIEW_DISCUSSION", "REJECTED", "UNDER_REVIEW"]);
  assert.equal(isReviewAction("APPROVED"), true);
  assert.equal(isReviewAction("PAYMENT_PENDING"), false);
  assert.equal(isReviewAction("ACTIVE_FRANCHISE"), false);
  assert.match(ACTION.APPROVED.confirm, /doesn't reserve or allocate the district/);
});

test("rejection reasons: 10–1000 characters after trimming, same as the server", () => {
  assert.match(rejectionReasonError(""), /at least 10/);
  assert.match(rejectionReasonError("   short   "), /at least 10/);
  assert.equal(rejectionReasonError("Not enough local presence yet"), null);
  assert.equal(rejectionReasonError("x".repeat(1000)), null);
  assert.match(rejectionReasonError("x".repeat(1001)), /at most 1000/);
});

test("list query keeps only set filters; page count never drops below 1", () => {
  assert.equal(listQuery({}), "");
  assert.equal(listQuery({ status: "REJECTED", q: "", page: 2 }), "?status=REJECTED&page=2");
  assert.equal(listQuery({ q: "FA-2026 & co" }), "?q=FA-2026+%26+co");
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(statusTone("REJECTED"), "bad");
  assert.equal(statusTone("APPROVED"), "good");
});

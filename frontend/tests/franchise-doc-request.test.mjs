// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { REQUEST_KINDS, groupDocuments, kindLabel, replyFormError, requestEvents, requestFormError } from "../lib/franchise-doc-request.ts";
import { listQuery } from "../lib/franchise-review.ts";

test("the admin's message is required: 10–500 characters after trimming", () => {
  assert.match(requestFormError("   short  "), /at least 10/);
  assert.equal(requestFormError("Please send a clearer address proof."), null);
  assert.match(requestFormError("x".repeat(501)), /at most 500/);
  assert.deepEqual(REQUEST_KINDS.map((k) => k.kind), ["ID_PROOF", "PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN", "ADDITIONAL"]);
  assert.equal(kindLabel("ADDITIONAL"), "Other document");
});

test("a reply needs every requested document, nothing unrequested, and text for a message-only request", () => {
  const req = { kinds: ["ID_PROOF", "ADDITIONAL"] };
  assert.match(replyFormError(req, { ID_PROOF: 1 }, ""), /Other document is required/);
  assert.match(replyFormError(req, { ID_PROOF: 1, ADDITIONAL: 1, PHOTO: 1 }, ""), /Photograph wasn't requested/);
  assert.match(replyFormError(req, { ID_PROOF: 2, ADDITIONAL: 1 }, ""), /one file per document/);
  assert.match(replyFormError(req, { ID_PROOF: 1, ADDITIONAL: 4 }, ""), /at most 3/);
  assert.equal(replyFormError(req, { ID_PROOF: 1, ADDITIONAL: 3 }, ""), null);
  assert.match(replyFormError({ kinds: [] }, {}, "  "), /write a reply/);
  assert.equal(replyFormError({ kinds: [] }, {}, "Monday works."), null);
  assert.match(replyFormError({ kinds: [] }, {}, "x".repeat(1001)), /at most 1000/);
});

test("documents: the newest of a kind is current, older ones are earlier versions; other documents stand alone", () => {
  const docs = [
    { id: "id1", kind: "ID_PROOF", createdAt: "2026-11-19T06:00:00Z" },
    { id: "ph1", kind: "PHOTO", createdAt: "2026-11-19T06:00:01Z" },
    { id: "id2", kind: "ID_PROOF", createdAt: "2026-11-20T06:00:00Z", documentRequestId: "r1" },
    { id: "ad1", kind: "ADDITIONAL", createdAt: "2026-11-20T06:00:01Z", documentRequestId: "r1" },
    { id: "ad2", kind: "ADDITIONAL", createdAt: "2026-11-20T06:00:02Z", documentRequestId: "r1" },
    { id: "id3", kind: "ID_PROOF", createdAt: "2026-11-21T06:00:00Z", documentRequestId: "r2" },
  ];
  const g = groupDocuments(docs);
  assert.deepEqual(g.map((x) => [x.kind, x.current.id, x.earlier.map((e) => e.id)]), [
    ["ID_PROOF", "id3", ["id2", "id1"]],
    ["PHOTO", "ph1", []],
    ["ADDITIONAL", "ad1", []],
    ["ADDITIONAL", "ad2", []],
  ]);
});

test("request events for the history, and the list filter in the query", () => {
  const ev = requestEvents([
    { id: "r1", status: "FULFILLED", kinds: ["PHOTO"], message: "m", createdAt: "2026-11-19T06:00:00Z", repliedAt: "2026-11-19T07:00:00Z", cancelledAt: null, responseText: null },
    { id: "r2", status: "CANCELLED", kinds: [], message: "m", createdAt: "2026-11-19T08:00:00Z", repliedAt: null, cancelledAt: "2026-11-19T09:00:00Z", responseText: null },
  ]);
  assert.deepEqual(ev.map((e) => [e.title, e.detail]), [["More information requested", "Asked for: Photograph"], ["Reply sent", null], ["More information requested", null], ["Request closed", null]]);
  assert.equal(listQuery({ info: "WAITING", status: "" }), "?info=WAITING");
});

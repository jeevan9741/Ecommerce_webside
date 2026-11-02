// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFile, formatBytes, formatRupees, isValidMobile, parseInvestment, requirementFor, stepIndex, MAX_DOCUMENT_BYTES } from "../lib/franchise-form.ts";

test("mobile numbers: 10 digits starting 6-9", () => {
  assert.equal(isValidMobile("9876543210"), true);
  assert.equal(isValidMobile(" 6000000000 "), true);
  assert.equal(isValidMobile("5876543210"), false);
  assert.equal(isValidMobile("987654321"), false);
  assert.equal(isValidMobile("+919876543210"), false);
});

test("investment capacity: whole rupees up to ₹100 crore, empty allowed", () => {
  assert.deepEqual(parseInvestment(""), { ok: true, value: null });
  assert.deepEqual(parseInvestment("₹5,00,000"), { ok: true, value: "500000" });
  assert.deepEqual(parseInvestment("1000000000"), { ok: true, value: "1000000000" });
  assert.deepEqual(parseInvestment("1000000001"), { ok: false });
  assert.deepEqual(parseInvestment("1000.50"), { ok: false });
  assert.deepEqual(parseInvestment("-5"), { ok: false });
});

test("files: PDF/JPEG/PNG, not empty, at most 5 MB", () => {
  assert.equal(checkFile({ name: "a.pdf", type: "application/pdf", size: 10 }), null);
  assert.equal(checkFile({ name: "a.jpg", type: "image/jpg", size: 10 }), null);
  assert.match(checkFile({ name: "a.pdf", type: "application/pdf", size: 0 }), /empty/);
  assert.match(checkFile({ name: "a.pdf", type: "application/pdf", size: MAX_DOCUMENT_BYTES + 1 }), /5 MB/);
  assert.match(checkFile({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 }), /PDF, JPEG or PNG/);
  assert.match(checkFile({ name: "a.svg", type: "image/svg+xml", size: 10 }), /PDF, JPEG or PNG/);
});

test("ID proof is always required; others follow the published requirements; undecided means not requested", () => {
  const reqs = { PHOTO: "REQUIRED", ADDRESS_PROOF: "OPTIONAL", BUSINESS_PLAN: "NOT_REQUESTED" };
  assert.equal(requirementFor("ID_PROOF", null), "REQUIRED");
  assert.equal(requirementFor("PHOTO", reqs), "REQUIRED");
  assert.equal(requirementFor("ADDRESS_PROOF", reqs), "OPTIONAL");
  assert.equal(requirementFor("BUSINESS_PLAN", reqs), "NOT_REQUESTED");
  assert.equal(requirementFor("PHOTO", null), "NOT_REQUESTED");
});

test("formatting and status order", () => {
  assert.equal(formatRupees(500000), "₹5,00,000");
  assert.equal(formatRupees("1000000000"), "₹1,00,00,00,000");
  assert.equal(formatRupees(999), "₹999");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(stepIndex("APPLICATION_SUBMITTED"), 0);
  assert.equal(stepIndex("ACTIVE_FRANCHISE"), 6);
  assert.equal(stepIndex("REJECTED"), -1);
});

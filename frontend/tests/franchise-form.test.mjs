// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationStepIssue, checkFile, EMAIL_CHANGE_HINT, formatBytes, formatRupees, isValidMobile, isValidPincode, normalizeMobile, normalizePincode, parseInvestment, requirementFor, stepIndex, MAX_DOCUMENT_BYTES } from "../lib/franchise-form.ts";

test("mobile numbers: 10 digits starting 6-9, typed the ways people type them", () => {
  assert.equal(isValidMobile("9876543210"), true);
  assert.equal(isValidMobile(" 6000000000 "), true);
  // Common Indian formats used to get cut off by the field's 10-character limit and then rejected.
  for (const typed of ["+919876543210", "+91 98765 43210", "+91-98765-43210", "91 9876543210", "098765 43210", "98765 43210", "(98765) 43210"]) {
    assert.equal(normalizeMobile(typed), "9876543210", typed);
    assert.equal(isValidMobile(typed), true, typed);
  }
  for (const bad of ["5876543210", "987654321", "98765432100", "+92 98765 43210", "abcdefghij", ""]) assert.equal(isValidMobile(bad), false, bad);
});

test("PIN code spacing is accepted and normalised", () => {
  for (const typed of ["500001", "500 001", "500-001", " 500001 "]) assert.equal(normalizePincode(typed), "500001", typed);
  assert.equal(isValidPincode("500 001"), true);
  assert.equal(isValidPincode("500 00"), false);
});

test("a step problem names the field to focus, so the reason is never off-screen", () => {
  const ok = { applicantName: "Asha Rao", mobile: "+91 98765 43210", stateId: "s1", districtId: "d1", address: "12 Market Road, Anantapur", pincode: "515 001", investmentCapacityInr: "" };
  assert.equal(applicationStepIssue(0, ok), null);
  assert.equal(applicationStepIssue(0, { ...ok, mobile: "+91 98765 " })?.field, "mobile");
  assert.equal(applicationStepIssue(0, { ...ok, pincode: "500 00" })?.field, "pincode");
  assert.equal(applicationStepIssue(0, { ...ok, districtId: "" })?.field, "districtId");
  assert.equal(applicationStepIssue(1, { ...ok, investmentCapacityInr: "1.5" })?.field, "investmentCapacityInr");
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

test("PIN code: six digits, not starting with 0 (the backend's rule)", () => {
  for (const ok of ["500001", "110001", " 560001 ", "999999"]) assert.equal(isValidPincode(ok), true, ok);
  for (const bad of ["", "012345", "50001", "5000011", "50A001", "500 00", "+500001"]) assert.equal(isValidPincode(bad), false, bad);
});

test("the locked email field explains how to use a different email", () => {
  assert.equal(EMAIL_CHANGE_HINT, "To use a different email, sign in with that account.");
});

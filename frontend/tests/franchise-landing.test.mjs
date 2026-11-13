// Run with `npm test` (Node strips the TypeScript types of the imported modules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_DISTRICTS_NOTICE, districtSummary, isDraftPolicyText, stateSummary } from "../lib/franchise-landing.ts";
import { applicationStepProblem, formatShareBps, APPLICATION_STEPS } from "../lib/franchise-form.ts";

test("district summary: counts per state, states with an open district first, then by name", () => {
  const s = districtSummary([
    { id: "b", name: "Bihar", districts: [{ available: false }] },
    { id: "z", name: "Assam", districts: [{ available: false }, { available: false }] },
    { id: "k", name: "Kerala", districts: [{ available: true }, { available: false }, { available: true }] },
  ]);
  assert.deepEqual(s.rows.map((r) => [r.state.name, r.available, r.total]), [["Kerala", 2, 3], ["Assam", 0, 2], ["Bihar", 0, 1]]);
  assert.deepEqual([s.availableDistricts, s.totalDistricts], [2, 6]);
  assert.deepEqual(districtSummary([]), { rows: [], totalDistricts: 0, availableDistricts: 0 });
});

test("state summary: available states first, then reserved, then closed; counts per availability", () => {
  const s = stateSummary([
    { id: "k", name: "Karnataka", availability: "CLOSED", districts: [] },
    { id: "m", name: "Maharashtra", availability: "AVAILABLE", districts: [] },
    { id: "g", name: "Goa", availability: "RESERVED", districts: [] },
    { id: "a", name: "Assam", availability: "AVAILABLE", districts: [] },
  ]);
  assert.deepEqual(s.rows.map((r) => r.name), ["Assam", "Maharashtra", "Goa", "Karnataka"]);
  assert.deepEqual([s.available, s.reserved, s.closed, s.total], [2, 1, 1, 4]);
  assert.deepEqual(stateSummary([]), { rows: [], available: 0, reserved: 0, closed: 0, total: 0 });
});

test("revenue shares are shown as percentages from basis points", () => {
  assert.equal(formatShareBps(8000), "80%");
  assert.equal(formatShareBps(2000), "20%");
  assert.equal(formatShareBps(1250), "12.5%");
  assert.equal(formatShareBps(3333), "33.33%");
  for (const bad of [-1, 10_001, 1.5, NaN]) assert.equal(formatShareBps(bad), "—");
});

test("application steps: three steps; steps 1 and 2 stop on the backend's own rules", () => {
  assert.equal(APPLICATION_STEPS.length, 3);
  const ok = { applicantName: "Asha Rao", mobile: "9876543210", stateId: "s1", districtId: "d1", address: "12 Market Road, Anantapur", investmentCapacityInr: "" };
  assert.equal(applicationStepProblem(0, ok), null);
  assert.match(applicationStepProblem(0, { ...ok, applicantName: " A " }) ?? "", /full name/);
  assert.match(applicationStepProblem(0, { ...ok, mobile: "12345" }) ?? "", /mobile/);
  assert.match(applicationStepProblem(0, { ...ok, stateId: "" }) ?? "", /state/);
  assert.match(applicationStepProblem(0, { ...ok, districtId: "" }) ?? "", /district/);
  assert.match(applicationStepProblem(0, { ...ok, address: "short" }) ?? "", /address/);
  assert.equal(applicationStepProblem(1, ok), null);
  assert.equal(applicationStepProblem(1, { ...ok, investmentCapacityInr: "₹5,00,000" }), null);
  assert.match(applicationStepProblem(1, { ...ok, investmentCapacityInr: "5.5" }) ?? "", /whole number/);
  assert.equal(applicationStepProblem(2, { ...ok, applicantName: "" }), null, "documents are checked on submit");
});

test("policy text that marks itself as a draft or sample is recognised; ordinary text is not", () => {
  for (const t of ["LOCAL PREVIEW SAMPLE — not an approved ETA policy.", "DRAFT pending lawyer approval", "  Draft: x", "Sample text", "PLACEHOLDER"]) assert.equal(isDraftPolicyText(t), true, t);
  for (const t of ["The franchise fee is refundable until the agreement is signed.", "Drafting a business plan is optional.", "", null, undefined]) assert.equal(isDraftPolicyText(t), false, String(t));
});

test("the demonstration notice uses the agreed wording", () => {
  assert.equal(DEMO_DISTRICTS_NOTICE, "Demonstration data only — district availability is not verified for applications.");
});

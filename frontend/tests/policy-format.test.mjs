// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeValue, formatBps, formatPaise, isPending, paiseToRupeesInput, rupeesToPaise } from "../lib/policy-format.ts";

test("paise format with Indian grouping and exact BigInt arithmetic", () => {
  assert.equal(formatPaise("10000000"), "₹1,00,000.00");
  assert.equal(formatPaise("50000"), "₹500.00");
  assert.equal(formatPaise("1"), "₹0.01");
  assert.equal(formatPaise("900719925474099301"), "₹9,00,71,99,25,47,40,993.01", "beyond 2^53 stays exact");
  assert.equal(formatPaise("12.5"), "—");
});

test("rupee input converts to paise without floating point", () => {
  assert.equal(rupeesToPaise("1,00,000"), "10000000");
  assert.equal(rupeesToPaise("₹ 500"), "50000");
  assert.equal(rupeesToPaise("100000.5"), "10000050");
  assert.equal(rupeesToPaise("0.29"), "29", "0.29 is 29 paise, not 28.999…");
  assert.equal(rupeesToPaise("1.234"), null, "at most two decimals");
  assert.equal(rupeesToPaise("-5"), null);
  assert.equal(rupeesToPaise("abc"), null);
  assert.equal(paiseToRupeesInput("10000050"), "100000.50");
  assert.equal(paiseToRupeesInput("10000000"), "100000");
});

test("basis points and pending markers", () => {
  assert.equal(formatBps(8000), "80.00%");
  assert.equal(formatBps(1000), "10.00%");
  assert.equal(formatBps(1), "0.01%");
  assert.equal(isPending({ status: "PENDING" }), true);
  assert.equal(isPending({ status: "PENDING", extra: 1 }), false);
  assert.equal(describeValue("paise", { status: "PENDING" }), "PENDING (decision not made)");
  assert.equal(describeValue("bps", 2000), "2000 bps (20.00%)");
  assert.equal(describeValue("channels", ["BANK", "UPI"]), "BANK + UPI");
  assert.equal(describeValue("documents", { PHOTO: "REQUIRED", ADDRESS_PROOF: "OPTIONAL", BUSINESS_PLAN: "NOT_REQUESTED" }), "PHOTO: REQUIRED, ADDRESS_PROOF: OPTIONAL, BUSINESS_PLAN: NOT_REQUESTED");
});

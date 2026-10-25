// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CENTRE_PENDING, centreDisplay, centreForm, centrePatch, safeMapUrl } from "../lib/centre-details.ts";

const empty = { address: null, mapUrl: null, dates: null, schedule: null, inclusions: [], notes: null };

test("unconfigured packages show nothing invented", () => {
  // Production's CENTRE package currently has metadata = null.
  assert.deepEqual(centreDisplay(null), empty);
  assert.deepEqual(centreDisplay(undefined), empty);
  assert.deepEqual(centreDisplay([]), empty);
  assert.deepEqual(centreDisplay({ address: "   ", dates: 5, inclusions: "\n \n" }), empty);
  assert.equal(CENTRE_PENDING, "Details will be announced soon.");
});

test("configured details are trimmed, inclusions split per line", () => {
  const shown = centreDisplay({
    address: "  12 Training Road, Rayadurgam ",
    mapUrl: "https://maps.google.com/?q=academy",
    dates: "10–12 Nov 2026",
    schedule: "Day 1: 9 AM – 6 PM",
    inclusions: "Accommodation\n  Meals  \n\nStudy kit",
    notes: "Bring a photo ID",
    legacyKey: "ignored",
  });
  assert.deepEqual(shown, {
    address: "12 Training Road, Rayadurgam",
    mapUrl: "https://maps.google.com/?q=academy",
    dates: "10–12 Nov 2026",
    schedule: "Day 1: 9 AM – 6 PM",
    inclusions: ["Accommodation", "Meals", "Study kit"],
    notes: "Bring a photo ID",
  });
});

test("map links render only for http(s) URLs", () => {
  assert.equal(safeMapUrl("javascript:alert(1)"), null);
  assert.equal(safeMapUrl("data:text/html,x"), null);
  assert.equal(safeMapUrl("not a url"), null);
  assert.equal(safeMapUrl(42), null);
  assert.equal(safeMapUrl("http://maps.example/x"), "http://maps.example/x");
});

test("form round trip: every field is sent, blanks clear", () => {
  const form = centreForm({ address: "A", notes: 7, other: "x" });
  assert.deepEqual(form, { address: "A", mapUrl: "", dates: "", schedule: "", inclusions: "", notes: "" });

  assert.deepEqual(centrePatch({ ...form, dates: "  10 Nov  ", inclusions: " Meals \n\n Room " }), {
    address: "A",
    mapUrl: null,
    dates: "10 Nov",
    schedule: null,
    inclusions: "Meals\nRoom",
    notes: null,
  });
});

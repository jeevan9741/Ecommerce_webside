// Run with `npm test` (Node strips the TypeScript types of the imported module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PIN_PREFIX_STATES, pincodeStateCheck, pincodeStateWarning, statesForPincode } from "../lib/pincode-state.ts";

// LGD state codes of all 36 states and union territories (as imported from the official LGD file).
const ALL_STATE_CODES = Array.from({ length: 38 }, (_, i) => String(i + 1)).filter((c) => c !== "25" && c !== "26");

test("every state and union territory can be matched by at least one prefix", () => {
  assert.equal(ALL_STATE_CODES.length, 36);
  const covered = new Set(PIN_PREFIX_STATES.flatMap(([, states]) => states));
  assert.deepEqual(ALL_STATE_CODES.filter((c) => !covered.has(c)), []);
  assert.deepEqual([...covered].filter((c) => !ALL_STATE_CODES.includes(c)), [], "no unknown state codes");
});

test("real PIN codes match their state", () => {
  const samples = [
    ["110001", "7"], ["122001", "6"], ["141001", "3"], ["160017", "4"], ["160062", "3"], ["171001", "2"], ["190001", "1"], ["194101", "37"],
    ["226001", "9"], ["248001", "5"], ["263001", "5"], ["302001", "8"], ["380001", "24"], ["396230", "38"], ["362520", "38"], ["400001", "27"],
    ["403001", "30"], ["462001", "23"], ["492001", "22"], ["500001", "36"], ["507111", "36"], ["507111", "28"], ["515001", "28"], ["533464", "34"],
    ["560001", "29"], ["600001", "33"], ["605001", "34"], ["609602", "34"], ["682551", "31"], ["682001", "32"], ["673310", "34"], ["695001", "32"],
    ["700001", "19"], ["737101", "11"], ["744101", "35"], ["751001", "21"], ["781001", "18"], ["791111", "12"], ["793001", "17"], ["795001", "14"],
    ["796001", "15"], ["797112", "13"], ["799001", "16"], ["800001", "10"], ["834001", "20"],
  ];
  for (const [pin, code] of samples) assert.equal(pincodeStateCheck(pin, code), "MATCH", `${pin} → ${code}`);
});

test("shared prefixes accept all their states (never a false mismatch)", () => {
  assert.deepEqual([...statesForPincode("160001")].sort(), ["3", "4"]);
  assert.deepEqual([...statesForPincode("403001")].sort(), ["27", "30"]);
  assert.deepEqual([...statesForPincode("605001")].sort(), ["33", "34"]);
  assert.equal(statesForPincode("781001").length, 7, "North-East: any of the seven states");
  assert.equal(pincodeStateCheck("797112", "18"), "MATCH", "Dimapur area with Assam is not a mismatch");
});

test("clear mismatches are reported; Army Postal Service, unknown or malformed PINs are 'can't tell'", () => {
  assert.equal(pincodeStateCheck("695001", "36"), "MISMATCH", "Kerala PIN for Telangana");
  assert.equal(pincodeStateCheck("500001", "28"), "MISMATCH", "Hyderabad PIN for Andhra Pradesh");
  assert.equal(pincodeStateCheck("110001", "33"), "MISMATCH");
  for (const pin of ["900001", "990001", "290001", "350001", "540001", "860001", "012345", "12345", "abcdef", ""]) assert.equal(pincodeStateCheck(pin, "36"), "UNKNOWN", pin);
  assert.equal(pincodeStateCheck("500001", null), "UNKNOWN");
  assert.equal(pincodeStateCheck(null, "36"), "UNKNOWN");
  assert.equal(pincodeStateCheck("500 001", "36"), "MATCH", "spaces and dashes are ignored");
  assert.equal(pincodeStateWarning("Andhra Pradesh"), "This PIN code doesn't look like it's in Andhra Pradesh — please check.");
});

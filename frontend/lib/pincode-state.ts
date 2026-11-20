/**
 * Does a PIN code look like it belongs to a state? A light, state-level check from the PIN's first digits
 * (India Post postal circles), with no external data file. It is advisory only — never used to refuse an
 * application — and it errs on the side of "can't tell":
 *
 * - each prefix lists every state it can belong to (shared circles, enclaves and border areas accept all of
 *   them), and the longest matching prefix wins;
 * - Army Postal Service (90–99) and unknown prefixes are "can't tell".
 *
 * States are identified by their LGD state code (IndiaState.code). Source: India Post's PIN structure
 * (first digit = region, first 2–3 digits = postal circle / sorting district) as tabulated in Wikipedia's
 * "Postal Index Number", corrected for known enclaves and borders (Mohali, Diu, Yanam, Karaikal, Mahe,
 * Lakshadweep, Uttarakhand, Jharkhand, the North-East).
 *
 * This file is kept byte-for-byte identical in backend/src/utils and frontend/lib (a test checks it), and
 * it is import-free so both runtimes and the Node test runner can load it.
 */

export type PincodeStateResult = "MATCH" | "MISMATCH" | "UNKNOWN";

const S = {
  JK: "1", HP: "2", PB: "3", CH: "4", UK: "5", HR: "6", DL: "7", RJ: "8", UP: "9", BR: "10", SK: "11", AR: "12", NL: "13", MN: "14", MZ: "15", TR: "16",
  ML: "17", AS: "18", WB: "19", JH: "20", OD: "21", CG: "22", MP: "23", GJ: "24", MH: "27", AP: "28", KA: "29", GA: "30", LD: "31", KL: "32", TN: "33", PY: "34",
  AN: "35", TG: "36", LA: "37", DD: "38",
} as const;
const NORTH_EAST = [S.AS, S.AR, S.ML, S.MN, S.MZ, S.NL, S.TR];

/** [prefix, LGD state codes it can belong to]. Longest matching prefix wins. */
export const PIN_PREFIX_STATES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["11", [S.DL]],
  ["12", [S.HR]], ["13", [S.HR]],
  ["14", [S.PB]], ["15", [S.PB]],
  ["16", [S.PB, S.CH]],
  ["17", [S.HP]],
  ["18", [S.JK, S.LA]], ["19", [S.JK, S.LA]],
  ["20", [S.UP]], ["21", [S.UP]], ["22", [S.UP]], ["23", [S.UP]], ["25", [S.UP]], ["27", [S.UP]], ["28", [S.UP]],
  ["24", [S.UP, S.UK]], ["26", [S.UP, S.UK]],
  ["30", [S.RJ]], ["31", [S.RJ]], ["32", [S.RJ]], ["33", [S.RJ]], ["34", [S.RJ]],
  ["36", [S.GJ]], ["37", [S.GJ]], ["38", [S.GJ]], ["39", [S.GJ]],
  ["396", [S.GJ, S.DD]], ["3625", [S.GJ, S.DD]],
  ["40", [S.MH]], ["41", [S.MH]], ["42", [S.MH]], ["43", [S.MH]], ["44", [S.MH]],
  ["403", [S.GA, S.MH]],
  ["45", [S.MP]], ["46", [S.MP]], ["47", [S.MP]], ["48", [S.MP]],
  ["49", [S.CG]],
  ["50", [S.TG]], ["507", [S.TG, S.AP]],
  ["51", [S.AP]], ["52", [S.AP]], ["53", [S.AP]], ["533", [S.AP, S.PY]],
  ["56", [S.KA]], ["57", [S.KA]], ["58", [S.KA]], ["59", [S.KA]],
  ["60", [S.TN]], ["61", [S.TN]], ["62", [S.TN]], ["63", [S.TN]], ["64", [S.TN]], ["65", [S.TN]], ["66", [S.TN]],
  ["605", [S.TN, S.PY]], ["609", [S.TN, S.PY]],
  ["67", [S.KL]], ["68", [S.KL]], ["69", [S.KL]],
  ["673", [S.KL, S.PY]], ["6825", [S.KL, S.LD]],
  ["70", [S.WB]], ["71", [S.WB]], ["72", [S.WB]], ["73", [S.WB]], ["74", [S.WB]],
  ["737", [S.WB, S.SK]], ["744", [S.WB, S.AN]],
  ["75", [S.OD]], ["76", [S.OD]], ["77", [S.OD]],
  ["78", NORTH_EAST], ["79", NORTH_EAST],
  ["80", [S.BR]], ["84", [S.BR]], ["85", [S.BR]],
  ["81", [S.BR, S.JH]], ["82", [S.BR, S.JH]], ["83", [S.BR, S.JH]],
];

/** The LGD state codes a PIN code can belong to, or null when it can't be told (APS, unknown, malformed). */
export function statesForPincode(pincode: string): readonly string[] | null {
  const pin = pincode.replace(/[\s-]/g, "");
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  let best: readonly [string, readonly string[]] | null = null;
  for (const rule of PIN_PREFIX_STATES) {
    if (pin.startsWith(rule[0]) && (!best || rule[0].length > best[0].length)) best = rule;
  }
  return best ? best[1] : null;
}

/** MATCH when the PIN can belong to the state, MISMATCH when it can't, UNKNOWN when we can't tell. */
export function pincodeStateCheck(pincode: string | null | undefined, stateCode: string | null | undefined): PincodeStateResult {
  if (!pincode || !stateCode) return "UNKNOWN";
  const states = statesForPincode(pincode);
  if (!states) return "UNKNOWN";
  return states.includes(stateCode) ? "MATCH" : "MISMATCH";
}

/** The applicant's soft warning (never blocks submission). */
export const pincodeStateWarning = (stateName: string) => `This PIN code doesn't look like it's in ${stateName} — please check.`;

/**
 * Helpers for the public franchise page. Import-free so the Node test runner can load it.
 */

export interface DistrictLike {
  available: boolean;
}
export interface StateLike {
  id: string;
  name: string;
  districts: DistrictLike[];
}

/**
 * Policy text that marks itself as a placeholder: it starts with "DRAFT", "LOCAL PREVIEW SAMPLE",
 * "SAMPLE" or "PLACEHOLDER" (any case). Such text must never look like an approved policy.
 */
export function isDraftPolicyText(text: string | null | undefined): boolean {
  return /^\s*(?:draft|local preview sample|sample|placeholder)\b/i.test(text ?? "");
}

/** The notice shown wherever demonstration (not officially verified) districts are listed. */
export const DEMO_DISTRICTS_NOTICE = "Demonstration data only — district availability is not verified for applications.";

/** One primary franchise per state, so availability is per state (from the backend's allocations only). */
export type StateAvailabilityLike = "AVAILABLE" | "RESERVED" | "CLOSED";
const AVAILABILITY_ORDER: Record<StateAvailabilityLike, number> = { AVAILABLE: 0, RESERVED: 1, CLOSED: 2 };

/** States grouped by availability (available first, then reserved, then closed), alphabetical within each. */
export function stateSummary<S extends StateLike & { availability: StateAvailabilityLike }>(states: S[]) {
  const rows = [...states].sort((a, b) => AVAILABILITY_ORDER[a.availability] - AVAILABILITY_ORDER[b.availability] || a.name.localeCompare(b.name));
  const count = (a: StateAvailabilityLike) => rows.filter((s) => s.availability === a).length;
  return { rows, available: count("AVAILABLE"), reserved: count("RESERVED"), closed: count("CLOSED"), total: rows.length };
}

/** Per-state district counts, states with an open district first, then alphabetical. */
export function districtSummary<S extends StateLike>(states: S[]) {
  const rows = states.map((s) => ({ state: s, total: s.districts.length, available: s.districts.filter((d) => d.available).length }));
  rows.sort((a, b) => Number(b.available > 0) - Number(a.available > 0) || a.state.name.localeCompare(b.state.name));
  return {
    rows,
    totalDistricts: rows.reduce((n, r) => n + r.total, 0),
    availableDistricts: rows.reduce((n, r) => n + r.available, 0),
  };
}

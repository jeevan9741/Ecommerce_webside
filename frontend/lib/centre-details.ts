/**
 * Offline centre (CENTRE) package details, stored in the course's `metadata` and edited on the
 * admin Center Training page. Kept free of imports so the Node test runner can load it directly.
 */

export const CENTRE_FIELDS = ["address", "mapUrl", "dates", "schedule", "inclusions", "notes"] as const;
export type CentreField = (typeof CENTRE_FIELDS)[number];
export type CentreForm = Record<CentreField, string>;

/** What a buyer sees in place of a detail the academy hasn't configured yet. */
export const CENTRE_PENDING = "Details will be announced soon.";

export interface CentreDisplay {
  address: string | null;
  mapUrl: string | null;
  dates: string | null;
  schedule: string | null;
  inclusions: string[];
  notes: string | null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only http(s) links are rendered, whatever the stored value. */
export function safeMapUrl(value: unknown) {
  const url = text(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Normalises stored metadata (any shape, possibly null) for the student course page. */
export function centreDisplay(metadata: unknown): CentreDisplay {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  return {
    address: text(meta.address),
    mapUrl: safeMapUrl(meta.mapUrl),
    dates: text(meta.dates),
    schedule: text(meta.schedule),
    inclusions: (text(meta.inclusions) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    notes: text(meta.notes),
  };
}

/** Form values from stored metadata: every field present, "" for unset ones. */
export function centreForm(metadata: unknown): CentreForm {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  return Object.fromEntries(CENTRE_FIELDS.map((f) => [f, typeof meta[f] === "string" ? (meta[f] as string) : ""])) as CentreForm;
}

/**
 * The metadata patch for a save. Every field is sent — trimmed text, or null to clear it — so the
 * form is always the full truth for these keys, while the backend merge keeps any other keys.
 */
export function centrePatch(form: CentreForm): Record<CentreField, string | null> {
  return Object.fromEntries(
    CENTRE_FIELDS.map((f) => {
      const value = f === "inclusions" ? form[f].split("\n").map((l) => l.trim()).filter(Boolean).join("\n") : form[f].trim();
      return [f, value || null];
    })
  ) as Record<CentreField, string | null>;
}

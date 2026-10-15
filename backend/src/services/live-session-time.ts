/**
 * Time rules for live Zoom sessions. Pure functions (no database) so they're unit-testable.
 * Admins enter a wall-clock date and time in a named timezone; we store the UTC instant.
 */

export type LiveSessionState = "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `instant` in `timeZone`. */
function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-10-20" + "19:30" in Asia/Kolkata → the UTC instant. Throws on malformed input. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) throw new Error("Invalid date or time");
  const [year, month, day, hour, minute] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error("Invalid date or time");
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Rejects dates like 2026-02-31 that Date.UTC would silently roll over.
  if (new Date(wall).getUTCDate() !== day) throw new Error("Invalid date or time");
  // Two passes settle the offset across DST changes (a no-op for IST, which has none).
  let utc = wall - offsetAt(wall, timeZone);
  const second = offsetAt(utc, timeZone);
  if (wall - second !== utc) utc = wall - second;
  return new Date(utc);
}

/** The UTC instant back as { date: "YYYY-MM-DD", time: "HH:mm" } in `timeZone` (for edit forms). */
export function utcToZonedInput(instant: Date, timeZone: string) {
  const p = zonedParts(instant.getTime(), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

interface SessionTiming {
  startsAt: Date;
  endsAt: Date;
  joinOpensMinutesBefore: number;
  status: "SCHEDULED" | "CANCELLED";
}

export function joinOpensAt(s: SessionTiming) {
  return new Date(s.startsAt.getTime() - s.joinOpensMinutesBefore * 60_000);
}

export function sessionState(s: SessionTiming, now = new Date()): LiveSessionState {
  if (s.status === "CANCELLED") return "CANCELLED";
  if (now >= s.endsAt) return "COMPLETED";
  if (now >= s.startsAt) return "LIVE";
  return "UPCOMING";
}

/** Joining is allowed from `joinOpensMinutesBefore` before the start until the end, unless cancelled. */
export function canJoinNow(s: SessionTiming, now = new Date()) {
  return s.status !== "CANCELLED" && now >= joinOpensAt(s) && now < s.endsAt;
}

/**
 * Accepts only Zoom attendee join links (https, a zoom.us / zoom.com / zoomgov.com host). Host
 * "start" links (/s/… or a zak= token) carry the host's credentials and must never reach students.
 */
export function zoomJoinUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid Zoom meeting link";
  }
  if (url.protocol !== "https:") return "The Zoom link must start with https://";
  const host = url.hostname.toLowerCase();
  const zoomHost = ["zoom.us", "zoom.com", "zoomgov.com"].some((d) => host === d || host.endsWith(`.${d}`));
  if (!zoomHost) return "Use a Zoom meeting link (zoom.us)";
  if (url.username || url.password) return "Enter a valid Zoom meeting link";
  if (/^\/s\//i.test(url.pathname) || url.searchParams.has("zak")) {
    return "That's the host start link — paste the participant join link (zoom.us/j/…) instead";
  }
  return null;
}

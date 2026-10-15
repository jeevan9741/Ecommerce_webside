/**
 * Display rules for live Zoom sessions. The server decides access and hands out join links; these
 * only keep the badge, countdown and Join button current between fetches. No imports, so the unit
 * tests can run it directly.
 */

export type LiveSessionState = "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";

interface Timing {
  startsAt: string;
  endsAt: string;
  joinOpensAt: string;
  state: LiveSessionState;
}

/** State at `now` (ms, already corrected to server time). A cancellation always wins. */
export function liveState(s: Timing, now: number): LiveSessionState {
  if (s.state === "CANCELLED") return "CANCELLED";
  if (now >= Date.parse(s.endsAt)) return "COMPLETED";
  if (now >= Date.parse(s.startsAt)) return "LIVE";
  return "UPCOMING";
}

export function joinOpen(s: Timing, now: number) {
  return s.state !== "CANCELLED" && now >= Date.parse(s.joinOpensAt) && now < Date.parse(s.endsAt);
}

/** "3d 4h", "5h 12m", "12m 05s", "45s". */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** "Tue, 20 Oct 2026" in the session's timezone. */
export function formatSessionDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "7:00 PM" in the session's timezone. */
export function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).toUpperCase();
}

/** Short zone name, e.g. "IST" or "GMT+5:30". */
export function timeZoneLabel(timeZone: string, at: string) {
  const part = new Intl.DateTimeFormat("en-IN", { timeZone, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** "7:00 PM – 9:00 PM". */
export function formatTimeRange(startsAt: string, endsAt: string, timeZone: string) {
  return `${formatTime(startsAt, timeZone)} – ${formatTime(endsAt, timeZone)}`;
}

/** Whether a viewer in `viewerZone` sees different wall-clock times than the session's zone. */
export function differentOffset(timeZone: string, viewerZone: string, at: string) {
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", day: "numeric", hourCycle: "h23" }).format(new Date(at));
  return fmt(timeZone) !== fmt(viewerZone);
}

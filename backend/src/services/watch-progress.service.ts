/**
 * Watched-range bookkeeping for VideoProgress. A lesson counts as completed once 90% of it has
 * actually been played. The player reports where the current stretch of playback began
 * (`watchedFrom`) and where it is now; the server credits that stretch only as far as real time
 * allows since the previous report (up to 2× speed), so seeking to the end — or replaying the
 * same minute — never completes a video.
 */

export type WatchedRange = [number, number];

/** Share of a video that must be watched for it to count as completed. */
export const COMPLETION_SHARE = 0.9;
/** Fastest playback rate credited (the player offers up to 2×). */
const MAX_SPEED = 2;
/** Longest gap between reports that still counts as continuous playback (the player reports every 10 s). */
const MAX_REPORT_GAP_SECONDS = 60;
/** Slack for network and timer jitter. */
const TOLERANCE_SECONDS = 2;
/** Ranges closer than this are merged. */
const MERGE_GAP_SECONDS = 1;

export function parseRanges(value: unknown): WatchedRange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is WatchedRange => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]
  );
}

export function addRange(ranges: WatchedRange[], range: WatchedRange): WatchedRange[] {
  const sorted = [...ranges, range].sort((a, b) => a[0] - b[0]);
  const merged: WatchedRange[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + MERGE_GAP_SECONDS) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Seconds of the video covered by the ranges. */
export function coveredSeconds(ranges: WatchedRange[], duration: number) {
  return ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, duration) - Math.max(start, 0)), 0);
}

/**
 * The stretch a report may credit: from where playback began (`from`) to the current position,
 * but no longer than the real time since the previous report allows. Null when nothing played.
 */
export function creditedRange(opts: { from: number; to: number; previousReportAt: Date | null; now: Date }): WatchedRange | null {
  const elapsed = opts.previousReportAt ? Math.max(0, (opts.now.getTime() - opts.previousReportAt.getTime()) / 1000) : 0;
  const allowed = Math.min(elapsed, MAX_REPORT_GAP_SECONDS) * MAX_SPEED + TOLERANCE_SECONDS;
  const start = Math.max(opts.from, opts.to - allowed, 0);
  const end = Math.round(opts.to);
  return end - Math.floor(start) > 0 ? [Math.floor(start), end] : null;
}

/**
 * Display helpers for the Franchise Partner dashboard tables. Import-free so the Node test runner can
 * load it. They only format what the API returned — nothing is estimated or filled in.
 */

export const PROGRESS_UNAVAILABLE = "Progress data unavailable";

export interface ProgressRow {
  available: boolean;
  completedLessons: number | null;
  totalLessons: number | null;
  percent: number | null;
  isComplete: boolean | null;
}

/** "1 of 2 lessons · 50%", "Completed · 2 of 2 lessons", or the unavailable message — never a guessed value. */
export function progressLabel(p: ProgressRow): string {
  if (!p.available || p.totalLessons === null || p.completedLessons === null || p.percent === null) return PROGRESS_UNAVAILABLE;
  const lessons = `${p.completedLessons} of ${p.totalLessons} ${p.totalLessons === 1 ? "lesson" : "lessons"}`;
  return p.isComplete ? `Completed · ${lessons}` : `${lessons} · ${p.percent}%`;
}

/** Number of pages for a result (at least 1, so an empty result still shows "page 1 of 1"). */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0 || total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export const ENROLMENT_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", ENDED: "Ended" };
export const ACCESS_STATUS_LABEL: Record<string, string> = { ACTIVE: "Access active", REVOKED: "Access revoked" };
export const STUDENT_STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", ENDED: "Ended" };

/** Query string for a list request: only a search text and a page — the server ignores anything else anyway. */
export function listQuery(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (page > 1) params.set("page", String(page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

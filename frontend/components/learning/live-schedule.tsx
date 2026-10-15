"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, CalendarX, CheckCircle2, Clock, Loader2, Radio, RotateCw, Video } from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  differentOffset,
  formatCountdown,
  formatSessionDate,
  formatTime,
  formatTimeRange,
  joinOpen,
  liveState,
  timeZoneLabel,
  type LiveSessionState,
} from "@/lib/live-session";
import { learningService, openAfter, type PackageSummary, type StudentLiveSession } from "@/services/learningService";
import { Locked } from "@/components/learning/ebook-library";

type Data = { sessions: StudentLiveSession[]; packages: PackageSummary[]; unlock: PackageSummary[] };

/** Re-read the schedule this often (and on tab focus) so admin reschedules/cancellations show up. */
const REFRESH_MS = 2 * 60 * 1000;

/**
 * The published live-class schedule of the student's paid packages. The server never sends join
 * links here; the Join button asks for one, and the server re-checks purchase and joining window.
 */
export function LiveSchedule({ courseId }: { courseId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Server clock minus browser clock, so a wrong device clock doesn't open/close Join at the wrong time.
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await learningService.myLiveSessions(courseId);
      setOffset(Date.parse(res.serverTime) - Date.now());
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the live schedule.");
    }
  }, [courseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (error && !data) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-danger" />
        <p className="text-sm text-danger">{error}</p>
        <button type="button" onClick={() => void load()} className="btn-outline btn-sm">
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading live schedule">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (data.sessions.length === 0) {
    if (data.packages.length === 0) return <Locked packages={data.unlock} what="live Zoom training" />;
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <CalendarClock className="h-10 w-10 text-gold-500" />
        <p className="font-semibold text-parchment">Schedule not published yet</p>
        <p className="max-w-md text-sm text-parchment-muted">
          Your 7-day live training schedule will appear here as soon as the academy publishes it — with dates, times and a Join button for each
          session.
        </p>
      </div>
    );
  }

  const serverNow = now + offset;
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const groups = groupByPackage(data.sessions);
  return (
    <div className="space-y-8">
      {groups.map(({ course, sessions }) => (
        <section key={course.id}>
          {groups.length > 1 && <h2 className="mb-3 font-display text-lg font-semibold text-parchment">{course.title}</h2>}
          <ol className="space-y-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionCard session={s} now={serverNow} viewerZone={viewerZone} onStale={() => void load()} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function groupByPackage(sessions: StudentLiveSession[]) {
  const groups = new Map<string, { course: StudentLiveSession["course"]; sessions: StudentLiveSession[] }>();
  for (const s of sessions) {
    const g = groups.get(s.course.id) ?? { course: s.course, sessions: [] };
    g.sessions.push(s);
    groups.set(s.course.id, g);
  }
  return [...groups.values()];
}

const BADGES: Record<LiveSessionState, { label: string; className: string; icon: typeof Clock }> = {
  UPCOMING: { label: "Upcoming", className: "border-gold-500/50 bg-gold-500/10 text-gold-600", icon: Clock },
  LIVE: { label: "Live now", className: "border-danger bg-danger/15 text-danger", icon: Radio },
  COMPLETED: { label: "Completed", className: "border-emerald bg-emerald/15 text-emerald", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", className: "border-border-strong bg-surface text-parchment-muted", icon: CalendarX },
};

function SessionCard({
  session: s,
  now,
  viewerZone,
  onStale,
}: {
  session: StudentLiveSession;
  now: number;
  viewerZone: string;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = liveState(s, now);
  const open = joinOpen(s, now);
  const badge = BADGES[state];
  const BadgeIcon = badge.icon;
  const zone = timeZoneLabel(s.timezone, s.startsAt);
  const showLocal = differentOffset(s.timezone, viewerZone, s.startsAt);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await openAfter(async () => (await learningService.joinLiveSession(s.id)).joinUrl);
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 500 ? err.message : "Couldn't open the meeting. Please try again.");
      // The schedule may have changed (cancelled, rescheduled) — pick that up.
      if (err instanceof ApiError && err.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card p-4 sm:p-5 ${state === "LIVE" ? "border-danger/60" : ""} ${state === "CANCELLED" ? "opacity-80" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-gold-600/40 bg-gold-500/10 text-gold-600">
            <span className="text-[10px] font-bold uppercase leading-none">Day</span>
            <span className="text-lg font-bold leading-none">{s.dayNumber}</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`font-semibold text-parchment [overflow-wrap:anywhere] ${state === "CANCELLED" ? "line-through decoration-1" : ""}`}>{s.title}</h3>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${badge.className}`}>
                <BadgeIcon className={`h-3 w-3 ${state === "LIVE" ? "animate-pulse" : ""}`} />
                {badge.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-parchment">
              {formatSessionDate(s.startsAt, s.timezone)} · {formatTimeRange(s.startsAt, s.endsAt, s.timezone)} {zone}
            </p>
            {showLocal && (
              <p className="text-xs text-parchment-muted">
                Your time: {formatSessionDate(s.startsAt, viewerZone)} · {formatTimeRange(s.startsAt, s.endsAt, viewerZone)} {timeZoneLabel(viewerZone, s.startsAt)}
              </p>
            )}
            {s.description && <p className="mt-2 whitespace-pre-line text-sm text-parchment-muted">{s.description}</p>}
            {state === "CANCELLED" && (
              <p className="mt-2 text-sm text-parchment-muted">
                This session was cancelled{s.cancelReason ? `: ${s.cancelReason.replace(/[.!?]?\s*$/, ".")}` : "."} The academy will share any replacement here.
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 sm:w-52 sm:text-right">
          {state === "UPCOMING" && (
            <p className="mb-2 text-xs text-parchment-muted">
              Starts in <span className="font-semibold tabular-nums text-parchment">{formatCountdown(Date.parse(s.startsAt) - now)}</span>
            </p>
          )}
          {open ? (
            <button type="button" onClick={join} disabled={busy} className="btn-gold btn-block !px-4 text-sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {busy ? "Opening…" : "Join Live Meeting"}
            </button>
          ) : (
            <button type="button" disabled className="btn-outline btn-block !px-4 text-sm opacity-60">
              {state === "CANCELLED"
                ? "Cancelled"
                : state === "COMPLETED"
                  ? "Session ended"
                  : formatSessionDate(s.joinOpensAt, s.timezone) === formatSessionDate(new Date(now).toISOString(), s.timezone)
                    ? `Join opens ${formatTime(s.joinOpensAt, s.timezone)}`
                    : `Opens ${Math.round((Date.parse(s.startsAt) - Date.parse(s.joinOpensAt)) / 60000)} min before start`}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

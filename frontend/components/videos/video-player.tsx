"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ChevronRight, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatDuration, progressPercent, videoService, type WatchPayload } from "@/services/videoService";

/** Save while playing at most this often; also on pause, seek, end and when leaving the page. */
const SAVE_EVERY_MS = 10_000;
/** Refresh the signed URL this long before it expires, so long sessions never hit a dead link. */
const REFRESH_BEFORE_MS = 5 * 60_000;

/** Where the student is watching from: a package page, or a category in the Course Library. */
export type PlayerContext = { kind: "course"; courseId: string } | { kind: "category"; slug: string };

export function VideoPlayer({ context, videoId }: { context: PlayerContext; videoId: string }) {
  const basePath = context.kind === "course" ? `/dashboard/courses/${context.courseId}` : `/dashboard/library/${context.slug}`;
  const [data, setData] = useState<WatchPayload | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);
  const refreshing = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const playbackErrors = useRef<number[]>([]);

  const load = useCallback(async () => {
    const payload = await videoService.watch(videoId, context.kind);
    setData(payload);
    setCompleted(Boolean(payload.progress?.completed));
    return payload;
  }, [videoId, context.kind]);

  useEffect(() => {
    lastSave.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load()
      .then((payload) => {
        const p = payload.progress;
        const duration = payload.video.durationSeconds ?? Infinity;
        // Resume unless finished, barely started, or at the very end.
        if (p && !p.completed && p.positionSeconds > 5 && p.positionSeconds < duration - 5) {
          pendingSeek.current = p.positionSeconds;
          setResumedFrom(p.positionSeconds);
        } else {
          pendingSeek.current = null;
          setResumedFrom(null);
        }
      })
      .catch((err) =>
        setError({
          notFound: err instanceof ApiError && err.status === 404,
          message: err instanceof Error ? err.message : "Could not load this video.",
        })
      );
  }, [load]);

  const save = useCallback(
    (opts: { force?: boolean; completed?: boolean; keepalive?: boolean } = {}) => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.currentTime)) return;
      const now = Date.now();
      if (!opts.force && now - lastSave.current < SAVE_EVERY_MS) return;
      lastSave.current = now;
      const body = {
        positionSeconds: el.currentTime,
        durationSeconds: Number.isFinite(el.duration) ? el.duration : undefined,
        ...(opts.completed ? { completed: true } : {}),
      };
      if (opts.keepalive) {
        // The page is going away: fire-and-forget so the last position still lands.
        void videoService.saveProgress(videoId, body, true).catch(() => {});
        return;
      }
      videoService
        .saveProgress(videoId, body)
        .then(({ progress }) => {
          if (progress.completed) setCompleted(true);
        })
        .catch(() => {});
    },
    [videoId]
  );

  // Save when the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") save({ force: true, keepalive: true });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      save({ force: true, keepalive: true });
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [save]);

  /** Swaps in a fresh signed URL without losing the viewer's place. */
  const refreshStream = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const el = videoRef.current;
    const at = el?.currentTime ?? 0;
    const wasPlaying = el ? !el.paused : false;
    try {
      pendingSeek.current = at;
      const payload = await load();
      if (el && wasPlaying) el.addEventListener("loadedmetadata", () => void el.play().catch(() => {}), { once: true });
      return payload;
    } finally {
      refreshing.current = false;
    }
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const ms = new Date(data.expiresAt).getTime() - Date.now() - REFRESH_BEFORE_MS;
    const timer = setTimeout(() => void refreshStream(), Math.max(30_000, ms));
    return () => clearTimeout(timer);
  }, [data, refreshStream]);

  if (error) {
    return (
      <div className="card mx-auto mt-8 max-w-lg p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-danger" />
        <h1 className="mt-3 font-display text-xl font-semibold text-parchment">
          {error.notFound ? "This video isn't available" : "Couldn't load the video"}
        </h1>
        <p className="mt-2 text-sm text-parchment-muted">
          {error.notFound ? "It may have been removed, or it belongs to a course you haven't purchased." : error.message}
        </p>
        <Link href={basePath} className="btn-outline btn-sm mt-5">
          {context.kind === "course" ? "Back to course" : "Back to category"}
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const index = data.playlist.findIndex((p) => p.id === data.video.id);
  const next = index >= 0 ? data.playlist[index + 1] : undefined;
  const backHref = data.context.kind === "category" ? `${basePath}?section=${data.context.sectionSlug}` : basePath;

  return (
    <div>
      <Link href={backHref} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-500 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> {data.context.title}
      </Link>

      <div className="mt-3 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="overflow-hidden rounded-2xl bg-black shadow-lg">
            <video
              key={data.video.id}
              ref={videoRef}
              src={data.streamUrl}
              poster={data.video.thumbnailUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              onContextMenu={(e) => e.preventDefault()}
              className="aspect-video w-full"
              onLoadedMetadata={(e) => {
                if (pendingSeek.current !== null) {
                  e.currentTarget.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }
              }}
              onTimeUpdate={() => save()}
              onPause={() => save({ force: true })}
              onSeeked={() => save({ force: true })}
              onEnded={() => save({ force: true, completed: true })}
              onError={() => {
                // Usually the signed link expired mid-session (e.g. a long pause) — get a new one. If it
                // keeps failing the file itself is the problem, so stop retrying and say so.
                const now = Date.now();
                playbackErrors.current = playbackErrors.current.filter((t) => now - t < 60_000).concat(now);
                if (playbackErrors.current.length > 2) {
                  setError({ notFound: false, message: "This video can't be played right now. Please try again later or contact support." });
                  return;
                }
                void refreshStream();
              }}
            />
          </div>

          {resumedFrom !== null && (
            <p className="mt-3 text-xs text-parchment-muted">
              Resumed from {formatDuration(resumedFrom)}.{" "}
              <button
                type="button"
                className="font-semibold text-gold-500 hover:underline"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = 0;
                  setResumedFrom(null);
                }}
              >
                Start from the beginning
              </button>
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gold-500">
                Lesson {index + 1} of {data.playlist.length}
              </p>
              <h1 className="mt-1 font-display text-2xl font-semibold text-parchment">{data.video.title}</h1>
            </div>
            {completed && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/10 px-3 py-1 text-xs font-semibold text-emerald">
                <CheckCircle2 className="h-4 w-4" /> Completed
              </span>
            )}
          </div>
          {data.video.description && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-parchment-muted">{data.video.description}</p>
          )}
          {next && (
            <Link href={`${basePath}/videos/${next.id}`} className="btn-outline btn-sm mt-5">
              Next: {next.title} <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <aside className="card h-fit overflow-hidden">
          <p className="border-b border-border-soft px-4 py-3 text-sm font-semibold text-parchment">
            {data.context.kind === "category" ? data.context.title : "Course videos"}
          </p>
          <ol className="max-h-[60vh] overflow-y-auto">
            {data.playlist.map((p, i) => {
              const current = p.id === data.video.id;
              const pct = progressPercent(p.progress, p.durationSeconds);
              return (
                <li key={p.id}>
                  <Link
                    href={`${basePath}/videos/${p.id}`}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition ${current ? "bg-gold-500/10" : "hover:bg-surface-hover"}`}
                  >
                    {p.progress?.completed ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" />
                    ) : (
                      <PlayCircle className={`h-5 w-5 shrink-0 ${current ? "text-gold-500" : "text-parchment-muted"}`} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${current ? "font-semibold text-parchment" : "text-parchment"}`}>
                        {i + 1}. {p.title}
                      </span>
                      <span className="text-xs text-parchment-muted">
                        {formatDuration(p.durationSeconds)}
                        {pct > 0 && !p.progress?.completed ? ` · ${pct}%` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}

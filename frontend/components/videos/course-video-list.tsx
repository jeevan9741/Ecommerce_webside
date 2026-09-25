"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Film, Loader2, PlayCircle } from "lucide-react";
import { formatDuration, progressPercent, videoService, type StudentVideo } from "@/services/videoService";

/** The course's original video lessons, with each one's watch progress. Renders nothing if there are none. */
export function CourseVideoList({ courseId }: { courseId: string }) {
  const [videos, setVideos] = useState<StudentVideo[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    videoService
      .courseVideos(courseId)
      .then((r) => setVideos(r.videos))
      .catch(() => setError(true));
  }, [courseId]);

  if (error) return <p className="card mt-8 p-5 text-sm text-danger">Course videos couldn&apos;t be loaded. Please refresh the page.</p>;
  if (!videos) {
    return (
      <div className="mt-8 flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }
  if (videos.length === 0) return null;

  const done = videos.filter((v) => v.progress?.completed).length;
  // "Continue" = first unfinished video, so returning students pick up where they left off.
  const next = videos.find((v) => !v.progress?.completed) ?? videos[0];

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-parchment">Course Videos</h2>
          <p className="mt-1 text-sm text-parchment-muted">
            {done} of {videos.length} completed
          </p>
        </div>
        <Link href={`/dashboard/courses/${courseId}/videos/${next.id}`} className="btn-gold btn-sm">
          <PlayCircle className="h-4 w-4" /> {done === 0 && !next.progress ? "Start watching" : done === videos.length ? "Watch again" : "Continue"}
        </Link>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-soft">
        <div className="h-full rounded-full bg-emerald transition-all" style={{ width: `${(done / videos.length) * 100}%` }} />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {videos.map((v, i) => {
          const pct = progressPercent(v.progress, v.durationSeconds);
          return (
            <Link key={v.id} href={`/dashboard/courses/${courseId}/videos/${v.id}`} className="card card-interactive overflow-hidden">
              <div className="relative aspect-video bg-gradient-to-br from-[#1424a8] to-[#5b2de6]">
                {v.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Film className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-white/70" />
                )}
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {formatDuration(v.durationSeconds)}
                </span>
                {v.progress?.completed && <CheckCircle2 className="absolute right-2 top-2 h-6 w-6 rounded-full bg-white text-emerald" />}
                {pct > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div className="h-full bg-red-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold text-gold-500">Lesson {i + 1}</p>
                <p className="mt-0.5 line-clamp-2 font-semibold text-parchment">{v.title}</p>
                <p className="mt-1 text-xs text-parchment-muted">
                  {v.progress?.completed ? "Completed" : pct > 0 ? `${pct}% watched` : "Not started"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

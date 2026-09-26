"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, PlayCircle } from "lucide-react";
import { videoService, type StudentVideo } from "@/services/videoService";
import { VideoCard } from "@/components/videos/video-card";

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
        {videos.map((v, i) => (
          <VideoCard key={v.id} video={v} href={`/dashboard/courses/${courseId}/videos/${v.id}`} lesson={i + 1} />
        ))}
      </div>
    </section>
  );
}

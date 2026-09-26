import Link from "next/link";
import { CheckCircle2, Film } from "lucide-react";
import { formatDuration, progressPercent, type StudentVideo } from "@/services/videoService";

/** A lesson tile: thumbnail, duration, watch progress and completion. */
export function VideoCard({ video: v, href, lesson }: { video: StudentVideo; href: string; lesson: number }) {
  const pct = progressPercent(v.progress, v.durationSeconds);
  return (
    <Link href={href} className="card card-interactive overflow-hidden">
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
        <p className="text-xs font-semibold text-gold-500">Lesson {lesson}</p>
        <p className="mt-0.5 line-clamp-2 font-semibold text-parchment">{v.title}</p>
        <p className="mt-1 text-xs text-parchment-muted">
          {v.progress?.completed ? "Completed" : pct > 0 ? `${pct}% watched` : "Not started"}
        </p>
      </div>
    </Link>
  );
}

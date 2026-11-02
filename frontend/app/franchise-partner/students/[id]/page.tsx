"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Detail {
  id: string;
  name: string;
  linkedAt: string;
  courses: { title: string; enrolledAt: string; percent: number; completedLessons: number; totalLessons: number; isComplete: boolean; language: string | null }[];
}

/** One of the franchise's own students (the server returns 404 for anyone else's). */
export default function FranchiseStudentPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ student: Detail }>(`/franchise-partner/students/${encodeURIComponent(id)}`).then((r) => setS(r.student), (e) => setError(e instanceof Error ? e.message : "Something went wrong."));
  }, [id]);

  return (
    <div className="space-y-6">
      <Link href="/franchise-partner/students" className="inline-flex items-center gap-1 text-sm text-parchment-muted hover:text-parchment"><ArrowLeft className="h-4 w-4" /> All students</Link>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!s && !error && <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {s && (
        <>
          <div>
            <h1 className="font-display text-2xl font-semibold text-parchment">{s.name}</h1>
            <p className="mt-1 text-sm text-parchment-muted">Joined your franchise on {formatDate(s.linkedAt)}</p>
          </div>
          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">Courses and progress</h2>
            {s.courses.length === 0 ? (
              <p className="mt-3 text-sm text-parchment-muted">No courses yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {s.courses.map((c, i) => (
                  <li key={i}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-parchment">{c.title}{c.language ? ` · ${c.language}` : ""}</span>
                      <span className="text-parchment-muted">{c.isComplete ? "Completed" : `${c.completedLessons} of ${c.totalLessons} lessons`} · {c.percent}%</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-white/10" role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.title} progress`}>
                      <div className="h-2 rounded-full bg-gold-500" style={{ width: `${c.percent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-parchment-muted">Enrolled {formatDate(c.enrolledAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Lock, PlayCircle } from "lucide-react";
import { categoryService, type LibraryCategory } from "@/services/categoryService";
import { CategoryTile, ProgressBar } from "@/components/library/category-theme";

type Library = Awaited<ReturnType<typeof categoryService.library>>;

/** Category grid for the Course Library: every topic, with video counts, progress and lock state. */
export function CourseLibrary() {
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    categoryService
      .library()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="card p-5 text-sm text-danger">The course library couldn&apos;t be loaded. Please refresh the page.</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const { summary } = data;
  return (
    <div className="space-y-6">
      {summary.videoCount > 0 && (
        <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-parchment">Your progress</p>
            <p className="mt-0.5 text-xs text-parchment-muted">
              {summary.completedCount} of {summary.videoCount} videos completed across your unlocked categories
            </p>
            <ProgressBar percent={summary.progressPercent} className="mt-3" />
          </div>
          <p className="font-display text-3xl font-semibold text-parchment">{summary.progressPercent}%</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.categories.map((c) => (
          <CategoryCard key={c.id} category={c} />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({ category: c }: { category: LibraryCategory }) {
  return (
    <Link href={`/dashboard/library/${c.slug}`} className="card card-interactive flex flex-col p-5">
      <div className="flex items-start gap-3">
        <CategoryTile slug={c.slug} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-parchment">{c.name}</p>
          <p className="mt-0.5 text-xs text-parchment-muted">
            {c.videoCount} {c.videoCount === 1 ? "video" : "videos"}
            {c.subcategories.length > 0 && ` · ${c.subcategories.length} tracks`}
          </p>
        </div>
        {c.locked ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-hover px-2 py-0.5 text-[11px] font-semibold text-parchment-muted">
            <Lock className="h-3 w-3" /> Locked
          </span>
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-parchment-muted" />
        )}
      </div>

      {c.subcategories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {c.subcategories.map((s) => (
            <span key={s.id} className="rounded-full bg-gold-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold-600">
              {s.name.replace(`${c.name} `, "")}
              {!c.locked && s.videoCount > 0 && ` · ${s.completedCount}/${s.videoCount}`}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-4">
        {c.locked ? (
          <p className="text-xs text-parchment-muted">
            {c.packages.length ? `Unlock with ${c.packages.map((p) => p.title).join(" or ")}` : "Coming soon"}
          </p>
        ) : c.videoCount === 0 ? (
          <p className="text-xs text-parchment-muted">Videos coming soon</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-parchment-muted">
              <span className="inline-flex items-center gap-1">
                <PlayCircle className="h-3.5 w-3.5" /> {c.completedCount} of {c.videoCount} completed
              </span>
              <span className="font-semibold text-parchment">{c.progressPercent}%</span>
            </div>
            <ProgressBar percent={c.progressPercent} className="mt-2" />
          </>
        )}
      </div>
    </Link>
  );
}

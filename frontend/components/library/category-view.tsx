"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Film, Loader2, Lock, PlayCircle } from "lucide-react";
import { ApiError } from "@/lib/api";
import { categoryService, formatRupees, type CategoryDetail } from "@/services/categoryService";
import { CategoryTile, ProgressBar, sectionIcon } from "@/components/library/category-theme";
import { VideoCard } from "@/components/videos/video-card";

/** One category of the Course Library: subcategory tabs, per-track progress and the video list. */
export function CategoryView({ slug, initialSection }: { slug: string; initialSection?: string }) {
  const [data, setData] = useState<CategoryDetail | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [sectionSlug, setSectionSlug] = useState(initialSection ?? "");

  useEffect(() => {
    categoryService
      .category(slug)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? "missing" : "failed"));
  }, [slug]);

  function pickSection(next: string) {
    setSectionSlug(next);
    // Keep the tab in the URL so "back" from the player returns to it.
    window.history.replaceState(null, "", `?section=${next}`);
  }

  if (error) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <p className="font-semibold text-parchment">{error === "missing" ? "This category isn't available." : "Couldn't load this category."}</p>
        <Link href="/dashboard/library" className="btn-outline btn-sm mt-4">
          Back to Course Library
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const { category, sections } = data;
  const section = sections.find((s) => s.slug === sectionSlug) ?? sections[0];
  const hasTracks = category.subcategories.length > 0;

  return (
    <div>
      <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-xs font-semibold text-gold-500 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Course Library
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <CategoryTile slug={category.slug} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold text-parchment">{category.name}</h1>
          {category.description && <p className="mt-1 text-sm text-parchment-muted">{category.description}</p>}
          <p className="mt-1 text-xs text-parchment-muted">
            {category.videoCount} {category.videoCount === 1 ? "video" : "videos"}
            {hasTracks && ` in ${category.subcategories.length} tracks`}
          </p>
        </div>
        {!category.locked && category.videoCount > 0 && (
          <div className="sm:w-56">
            <div className="flex justify-between text-xs text-parchment-muted">
              <span>{category.completedCount} completed</span>
              <span className="font-semibold text-parchment">{category.progressPercent}%</span>
            </div>
            <ProgressBar percent={category.progressPercent} className="mt-1.5" />
          </div>
        )}
      </div>

      {category.locked ? (
        <LockedPanel detail={data} />
      ) : (
        <>
          {hasTracks && (
            <div role="tablist" className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {sections.map((s) => {
                const Icon = sectionIcon(s.slug);
                const active = s.id === section.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => pickSection(s.slug)}
                    className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                      active ? "border-gold-500 bg-gold-500/10 text-parchment" : "border-border-soft text-parchment-muted hover:border-gold-500/50"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-gold-500" : ""}`} />
                    <span>
                      <span className="block font-semibold">{s.name}</span>
                      <span className="block text-[11px]">
                        {s.videoCount ? `${s.completedCount}/${s.videoCount} completed` : "Coming soon"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <Section section={section} slug={category.slug} />
        </>
      )}
    </div>
  );
}

function Section({ section, slug }: { section: CategoryDetail["sections"][number]; slug: string }) {
  if (section.videos.length === 0) {
    return (
      <div className="card mt-6 flex flex-col items-center gap-2 p-10 text-center">
        <Film className="h-9 w-9 text-gold-500" />
        <p className="font-semibold text-parchment">Videos are on the way</p>
        <p className="text-sm text-parchment-muted">New lessons for {section.name} will appear here as soon as they&apos;re published.</p>
      </div>
    );
  }

  const done = section.videos.filter((v) => v.progress?.completed).length;
  // "Continue" = first unfinished video, so returning students pick up where they left off.
  const next = section.videos.find((v) => !v.progress?.completed) ?? section.videos[0];
  const href = (id: string) => `/dashboard/library/${slug}/videos/${id}`;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-parchment">{section.name}</h2>
          <p className="mt-1 text-sm text-parchment-muted">
            {done} of {section.videos.length} completed
          </p>
        </div>
        <Link href={href(next.id)} className="btn-gold btn-sm">
          <PlayCircle className="h-4 w-4" /> {done === 0 && !next.progress ? "Start watching" : done === section.videos.length ? "Watch again" : "Continue"}
        </Link>
      </div>
      <ProgressBar percent={section.progressPercent} className="mt-2" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {section.videos.map((v, i) => (
          <VideoCard key={v.id} video={v} href={href(v.id)} lesson={i + 1} />
        ))}
      </div>
    </section>
  );
}

function LockedPanel({ detail }: { detail: CategoryDetail }) {
  const { category } = detail;
  return (
    <div className="card mt-6 p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
        <div className="min-w-0">
          <p className="font-semibold text-parchment">Buy Course to Access</p>
          <p className="mt-1 text-sm text-parchment-muted">
            {category.packages.length
              ? `${category.name} is included in the following package${category.packages.length > 1 ? "s" : ""}:`
              : `${category.name} isn't included in a package yet — check back soon.`}
          </p>
        </div>
      </div>
      {category.packages.length > 0 && (
        <>
          <ul className="mt-4 space-y-2">
            {category.packages.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border-soft px-4 py-3 text-sm">
                <span className="font-semibold text-parchment">{p.title}</span>
                <span className="text-parchment-muted">{formatRupees(p.priceInPaise)}</span>
              </li>
            ))}
          </ul>
          <Link href="/courses" className="btn-gold btn-sm mt-5">
            View packages
          </Link>
        </>
      )}
      {detail.sections.length > 1 && (
        <div className="mt-6 border-t border-border-soft pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">What&apos;s inside</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {detail.sections.map((s) => (
              <li key={s.id} className="text-sm text-parchment">
                {s.name} <span className="text-parchment-muted">· {s.videoCount} videos</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

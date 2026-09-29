import { BadgePercent, BookOpen, PlayCircle, Repeat, Store, type LucideIcon } from "lucide-react";

/**
 * Every category uses the same neutral academy tile with a generic learning icon — no brand logos,
 * colours or marks for the platforms the categories are named after.
 */
const TILE_CLASS = "bg-gradient-to-br from-[#1424a8] to-[#5b2de6]";

/** Subcategory icon by its kind (…-affiliate / …-reselling / …-seller). */
export function sectionIcon(slug: string): LucideIcon {
  if (slug.endsWith("-affiliate")) return BadgePercent;
  if (slug.endsWith("-reselling")) return Repeat;
  if (slug.endsWith("-seller")) return Store;
  return PlayCircle;
}

export function CategoryTile({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl";
  return (
    <span className={`flex shrink-0 items-center justify-center text-white shadow-sm ${TILE_CLASS} ${box}`}>
      <BookOpen className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
    </span>
  );
}

/** Thin progress bar with an accessible value. */
export function ProgressBar({ percent, className = "" }: { percent: number; className?: string }) {
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-border-soft ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="h-full rounded-full bg-emerald transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

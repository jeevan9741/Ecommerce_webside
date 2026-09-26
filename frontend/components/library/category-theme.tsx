import {
  BadgePercent,
  Camera,
  GraduationCap,
  Layers,
  Package,
  PlayCircle,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  Store,
  ThumbsUp,
  Truck,
  type LucideIcon,
} from "lucide-react";

/** Visual identity per category slug; new admin-created categories fall back to the academy look. */
const THEMES: Record<string, { icon: LucideIcon; tile: string }> = {
  meesho: { icon: ShoppingBag, tile: "bg-gradient-to-br from-[#f43397] to-[#9f1e6a]" },
  flipkart: { icon: ShoppingCart, tile: "bg-gradient-to-br from-[#2874f0] to-[#1a4fb3]" },
  amazon: { icon: Package, tile: "bg-gradient-to-br from-[#232f3e] to-[#131921]" },
  "instagram-marketing": { icon: Camera, tile: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]" },
  "facebook-marketing": { icon: ThumbsUp, tile: "bg-gradient-to-br from-[#1877f2] to-[#0b4fb0]" },
  "youtube-marketing": { icon: PlayCircle, tile: "bg-gradient-to-br from-[#ff0000] to-[#b30000]" },
  dropshipping: { icon: Truck, tile: "bg-gradient-to-br from-[#0f9d8a] to-[#0a6b5e]" },
  "ecommerce-training-academy": { icon: GraduationCap, tile: "bg-gradient-to-br from-[#1424a8] to-[#5b2de6]" },
};

const FALLBACK = { icon: Layers, tile: "bg-gradient-to-br from-[#1424a8] to-[#5b2de6]" };

export function categoryTheme(slug: string) {
  return THEMES[slug] ?? FALLBACK;
}

/** Subcategory icon by its kind (…-affiliate / …-reselling / …-seller). */
export function sectionIcon(slug: string): LucideIcon {
  if (slug.endsWith("-affiliate")) return BadgePercent;
  if (slug.endsWith("-reselling")) return Repeat;
  if (slug.endsWith("-seller")) return Store;
  return PlayCircle;
}

export function CategoryTile({ slug, size = "md" }: { slug: string; size?: "md" | "lg" }) {
  const { icon: Icon, tile } = categoryTheme(slug);
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl";
  return (
    <span className={`flex shrink-0 items-center justify-center text-white shadow-sm ${tile} ${box}`}>
      <Icon className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} />
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

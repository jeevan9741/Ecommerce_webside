import { BookOpen, CheckCircle2, Crown, Video, Users, Building2, LucideIcon } from "lucide-react";
import { formatInr } from "@/lib/format";

export interface CourseLanguage {
  code: string;
  name: string;
  nativeName: string;
}

export interface CoursePublic {
  id: string;
  slug: string;
  type: "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";
  title: string;
  shortDescription: string;
  priceInPaise: number;
  languages: CourseLanguage[];
}

const ICONS: Record<CoursePublic["type"], LucideIcon> = {
  EBOOK: BookOpen,
  VIDEO: Video,
  ZOOM: Users,
  CENTRE: Building2,
};

const PACKAGE_LABEL: Record<CoursePublic["type"], string> = {
  EBOOK: "Starter Package",
  VIDEO: "Basic Video Training",
  ZOOM: "Live Zoom Masterclass",
  CENTRE: "VIP Center Training",
};

const FEATURES: Record<CoursePublic["type"], string[]> = {
  EBOOK: ["E-Books & Supplier List Access", "Dedicated Company Support"],
  VIDEO: ["Meesho, Flipkart, Amazon & Dropshipping Videos", "Meta Ads Training Included", "Customer Support"],
  ZOOM: ["7 Days Live Interactive Classes", "Detailed Explanation & Q&A", "Customer Support"],
  CENTRE: [
    "3 Days Direct Training at Center",
    "Free Food & Room Facility",
    "E-Books + Recording Videos Access",
    "Alternative Zoom Option Available",
  ],
};

// The Centre package is the academy's premium in-person offering — highlighted as the featured plan.
const FEATURED_TYPE: CoursePublic["type"] = "CENTRE";

export function CourseCard({
  course,
  alreadyPurchased = false,
  footer,
}: {
  course: CoursePublic;
  alreadyPurchased?: boolean;
  footer?: React.ReactNode;
}) {
  const Icon = ICONS[course.type];
  const featured = course.type === FEATURED_TYPE;

  return (
    <div
      id={course.slug}
      className={`relative flex h-full flex-col rounded-2xl bg-surface p-6 shadow-sm transition duration-300 hover:-translate-y-1 sm:p-7 ${
        featured
          ? "border-2 border-gold-500 bg-gradient-to-b from-gold-100/60 to-surface shadow-[0_25px_60px_-24px_rgba(37,99,235,0.35)] hover:shadow-[0_30px_70px_-18px_rgba(37,99,235,0.45)]"
          : "border border-border-soft hover:border-gold-500/50 hover:shadow-[0_20px_45px_-24px_rgba(37,99,235,0.3)]"
      }`}
    >
      {featured && (
        <span className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-b from-gold-400 to-gold-600 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg">
          <Crown className="h-3.5 w-3.5" /> Featured Plan
        </span>
      )}
      {alreadyPurchased && (
        // Sits lower on the featured card so it clears the overhanging "Featured Plan" badge.
        <span
          className={`absolute right-5 rounded-full border border-emerald bg-emerald/15 px-3 py-1 text-xs font-semibold text-emerald ${
            featured ? "top-9" : "top-5"
          }`}
        >
          Already Purchased
        </span>
      )}

      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-gold-600/40 bg-gold-500/10">
        <Icon className="h-6 w-6 text-gold-400" />
      </div>

      <p className="eyebrow mt-5">{PACKAGE_LABEL[course.type]}</p>
      <h3 className="mt-1.5 font-display text-xl font-semibold leading-snug text-parchment sm:text-2xl xl:text-xl">
        {course.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-parchment-muted">{course.shortDescription}</p>

      <ul className="mt-6 space-y-3">
        {FEATURES[course.type].map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-parchment">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {course.languages.length > 0 && (
        <p className="mt-4 text-xs text-parchment-muted">
          Available in: <span className="text-gold-400">{course.languages.map((l) => l.name).join(", ")}</span>
        </p>
      )}

      <div className="mt-6 flex flex-1 flex-col justify-end">
        <div className="mb-5 flex items-baseline gap-1 border-t border-border-soft pt-5">
          <span className="font-display text-2xl font-bold text-parchment sm:text-3xl xl:text-2xl">
            {formatInr(course.priceInPaise)}
          </span>
          <span className="text-xs text-parchment-muted">one-time</span>
        </div>
        {footer}
      </div>
    </div>
  );
}

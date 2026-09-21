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
      className={`group relative flex h-full min-w-0 flex-col rounded-[24px] p-6 transition duration-300 ease-out hover:-translate-y-1.5 sm:p-8 desk:p-7 2xl:p-8 ${
        featured
          ? "border-2 border-gold-500 bg-gradient-to-b from-white via-white to-blue-50/70 shadow-[0_24px_60px_-26px_rgba(37,99,235,0.45)] hover:shadow-[0_32px_70px_-22px_rgba(37,99,235,0.55)]"
          : "border border-slate-200/70 bg-white shadow-[0_12px_40px_-20px_rgba(15,23,42,0.16)] hover:border-gold-500/40 hover:shadow-[0_24px_50px_-22px_rgba(37,99,235,0.35)]"
      }`}
    >
      {featured && (
        <span className="absolute -top-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-[#1e40af] to-gold-600 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_-8px_rgba(30,64,175,0.7)]">
          <Crown className="h-4 w-4" aria-hidden /> Featured Plan
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

      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/25 bg-gradient-to-b from-blue-50 to-gold-100/70 text-gold-500 shadow-[0_6px_16px_-10px_rgba(37,99,235,0.5)] transition duration-300 group-hover:scale-105">
        <Icon className="h-6 w-6" aria-hidden />
      </div>

      <p className="mt-7 text-xs font-semibold uppercase tracking-[0.22em] text-gold-500">
        {PACKAGE_LABEL[course.type]}
      </p>
      <h3 className="mt-2 break-words font-display text-[1.5rem] font-bold leading-[1.25] text-parchment sm:text-[1.625rem] desk:text-[1.5rem] 2xl:text-[1.625rem]">
        {course.title}
      </h3>
      <p className="mt-3 text-[15px] leading-relaxed text-parchment-muted">{course.shortDescription}</p>

      <ul className="mt-6 space-y-3.5">
        {FEATURES[course.type].map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-[15px] leading-snug text-slate-800">
            <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-500" aria-hidden />
            <span className="min-w-0 break-words">{feature}</span>
          </li>
        ))}
      </ul>

      {/* flex-1 pushes price + button to the bottom so every card in a row lines up. */}
      <div className="mt-7 flex flex-1 flex-col justify-end">
        <div className="flex items-baseline gap-2 border-t border-slate-200 pt-7">
          <span className="font-display text-[2rem] font-bold leading-none text-parchment">
            {formatInr(course.priceInPaise)}
          </span>
          <span className="text-base text-parchment-muted">one-time</span>
        </div>
        <div className="mt-6">{footer}</div>
      </div>
    </div>
  );
}

"use client";

import { BookOpen, Building2, Infinity as InfinityIcon, ShieldCheck, Users, Video, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatInr } from "@/lib/format";
import type { CoursePublic } from "@/components/course-card";

const TYPE_ICON: Record<CoursePublic["type"], LucideIcon> = {
  EBOOK: BookOpen,
  VIDEO: Video,
  ZOOM: Users,
  CENTRE: Building2,
};

const TYPE_LABEL: Record<CoursePublic["type"], string> = {
  EBOOK: "E-Book Package",
  VIDEO: "Recorded Video Course",
  ZOOM: "Live Zoom Masterclass",
  CENTRE: "In-Person Centre Training",
};

/**
 * The total shown is exactly what the backend charges (course.priceInPaise). Course
 * prices are GST-inclusive, so tax is shown as included rather than as an added line
 * that would disagree with the amount on the Razorpay order.
 */
export function OrderSummary({ course }: { course: CoursePublic }) {
  const Icon = TYPE_ICON[course.type];

  return (
    <section
      aria-labelledby="order-summary-heading"
      className="relative overflow-hidden rounded-[24px] border border-white/60 bg-white/80 p-5 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gold-400/20 blur-3xl" aria-hidden />

      <h3 id="order-summary-heading" className="text-xs font-semibold uppercase tracking-[0.18em] text-parchment-muted">
        Order Summary
      </h3>

      <div className="mt-4 flex items-center gap-4">
        {/* Courses have no image field yet — a type-branded tile stands in for a thumbnail. */}
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-gold-400 via-gold-500 to-gold-600 shadow-lg">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_60%)]" aria-hidden />
          <Icon className="relative h-9 w-9 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-500">{TYPE_LABEL[course.type]}</p>
          <p className="mt-0.5 font-display text-lg font-semibold leading-snug text-parchment">{course.title}</p>
        </div>
      </div>

      <dl className="mt-6 space-y-3 border-t border-dashed border-border-strong pt-5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-parchment-muted">Course price</dt>
          <dd className="font-medium text-parchment">{formatInr(course.priceInPaise)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-parchment-muted">GST</dt>
          <dd className="font-medium text-emerald">Included</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-parchment-muted">Convenience fee</dt>
          <dd className="font-medium text-emerald">₹0</dd>
        </div>
        <div className="flex items-end justify-between border-t border-border-soft pt-4">
          <dt className="font-semibold text-parchment">Total payable</dt>
          <dd className="font-display text-2xl font-bold text-parchment">{formatInr(course.priceInPaise)}</dd>
        </div>
      </dl>

      <ul className="mt-5 space-y-2 text-xs text-parchment-muted">
        <li className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-gold-500" aria-hidden /> Access unlocks instantly after payment
        </li>
        <li className="flex items-center gap-2">
          <InfinityIcon className="h-3.5 w-3.5 text-gold-500" aria-hidden /> One-time payment, no subscription
        </li>
        <li className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-gold-500" aria-hidden /> Payment processed securely by Razorpay
        </li>
      </ul>
    </section>
  );
}

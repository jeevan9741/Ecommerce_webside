"use client";

import { useEffect, useRef, useState } from "react";

export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ecaBlue" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#93c5fd" />
          <stop offset="0.5" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" stroke="url(#ecaBlue)" strokeWidth="1.5" />
      <path
        d="M24 10L12 16.5V25C12 32.5 17.2 38.6 24 40C30.8 38.6 36 32.5 36 25V16.5L24 10Z"
        stroke="url(#ecaBlue)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 24.2L22 28.6L30.8 19.4"
        stroke="url(#ecaBlue)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Renders the uploaded academy logo (public/brand/logo.png) when present, cross-fading in
 * over the built-in blue vector mark once it's confirmed loaded. The SVG is the default,
 * always-visible state, so a missing/404 asset never produces a broken-image flash — we only
 * ever need to detect success, never failure, which avoids the hydration race that comes with
 * relying on a fast 404's error event firing before React attaches its listeners.
 */
export function BrandLogo({ className = "h-9 w-9" }: { className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`}>
      <Logo className={`h-full w-full transition-opacity duration-300 ${loaded ? "opacity-0" : "opacity-100"}`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> so we control the fade via onLoad */}
      <img
        ref={imgRef}
        src="/brand/logo.png"
        alt="E-Commerce Training Academy"
        className={`absolute inset-0 h-full w-full rounded-full object-contain transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}

export function LogoMark({
  className = "",
  variant = "dark",
  size = "md",
}: {
  className?: string;
  /** "dark" for use on light backgrounds (default), "white" for blue banners (navbar, footer, sidebar). */
  variant?: "dark" | "white";
  /** "lg" is the larger, responsive lockup used in the main navbar. */
  size?: "md" | "lg";
}) {
  const isWhite = variant === "white";
  const lg = size === "lg";
  return (
    <div className={`flex items-center ${lg ? "gap-2.5 sm:gap-3" : "gap-2.5"} ${className}`}>
      <BrandLogo className={lg ? "h-9 w-9 shrink-0 sm:h-11 sm:w-11 lg:h-12 lg:w-12" : undefined} />
      <span
        className={`font-display tracking-wide ${
          lg ? "text-[1.15rem] leading-none sm:text-[1.35rem] lg:text-[1.5rem]" : "text-[1.05rem] leading-tight"
        } ${isWhite ? "text-white" : "text-parchment"}`}
      >
        E-Commerce
        <span
          className={`block font-body font-semibold uppercase ${
            lg ? "mt-1 text-[9px] tracking-[0.24em] sm:text-[11px] lg:text-[12.5px] lg:tracking-[0.28em]" : "-mt-1 text-xs tracking-[0.25em]"
          } ${isWhite ? (lg ? "text-white/95" : "text-blue-100") : "text-gold-500"}`}
        >
          Training Academy
        </span>
      </span>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { WELCOME_PARAM } from "@/lib/routes";

/** The section this component scrolls to; the Courses page puts it on the package grid. */
export const PACKAGES_ANCHOR = "packages";

/** Breathing room between the sticky header and the first card. */
const GAP = 12;

/**
 * Brings the packages into view when someone arrives straight from signup (`?welcome=1`).
 * The offset is measured from the real header rather than hard-coded, so phones and desktops —
 * whose sticky navbar is a different height — end up with the cards in the same place.
 */
export function ScrollToPackages() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get(WELCOME_PARAM) !== "1") return;

    // Drop the flag first so a reload or a shared URL doesn't scroll again. replaceState keeps
    // this out of the router, which would otherwise re-render the page and undo the scroll.
    const { pathname, hash } = window.location;
    window.history.replaceState(null, "", `${pathname}${hash}`);

    const target = document.getElementById(PACKAGES_ANCHOR);
    if (!target) return;

    // One frame, so the grid has been laid out and the offset we measure is the final one.
    const frame = requestAnimationFrame(() => {
      const header = document.querySelector("header");
      const offset = (header?.getBoundingClientRect().height ?? 0) + GAP;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}

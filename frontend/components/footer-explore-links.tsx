"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { readClientToken } from "@/lib/api";
import { homeFor } from "@/lib/routes";
import { readClaims } from "@/lib/token-claims";

const noSubscribe = () => () => {};

/**
 * The footer's "Explore" links depend on whether someone is signed in. Deciding that here, from
 * the session cookie, keeps the footer (and so every marketing page) free of per-request server
 * work — which lets those pages be served from cache. The server render shows the signed-out links.
 */
export function FooterExploreLinks() {
  const role = useSyncExternalStore(
    noSubscribe,
    () => {
      const claims = readClaims(readClientToken());
      return claims ? (claims.role ?? "USER") : null;
    },
    () => null
  );

  if (!role) {
    return (
      <li>
        <Link href="/about" className="hover:text-white">About Us</Link>
      </li>
    );
  }
  return (
    <>
      <li>
        <Link href={homeFor(role)} className="hover:text-white">{role === "ADMIN" ? "Admin Panel" : "Dashboard"}</Link>
      </li>
      <li>
        <Link href="/courses" className="hover:text-white">Courses</Link>
      </li>
    </>
  );
}

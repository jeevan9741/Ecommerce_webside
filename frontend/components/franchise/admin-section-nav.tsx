"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FRANCHISE_ADMIN_SECTIONS, activeFranchiseSection, isFranchiseAdminPath } from "@/lib/franchise-admin-nav";

/**
 * The Franchise Management section menu, shown above every franchise admin page. A horizontal tab bar
 * on desktop; on small screens it scrolls sideways (every section stays one tap away).
 */
export function FranchiseAdminSectionNav() {
  const pathname = usePathname();
  if (!isFranchiseAdminPath(pathname)) return null;
  const active = activeFranchiseSection(pathname);
  return (
    <nav aria-label="Franchise Management" className="mb-6 border-b border-white/10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-parchment-muted">Franchise Management</p>
      <ul className="-mb-px flex gap-1 overflow-x-auto pb-px [scrollbar-width:thin]">
        {FRANCHISE_ADMIN_SECTIONS.map((s) => {
          const current = s.href === active;
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={current ? "page" : undefined}
                className={`inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  current ? "border-gold-500 text-parchment" : "border-transparent text-parchment-muted hover:border-white/20 hover:text-parchment"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

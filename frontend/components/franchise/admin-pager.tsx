"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** Previous / next paging for admin franchise lists. Hidden when everything fits on one page. */
export function AdminPager({ page, pageSize, total, onPage, busy = false }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 p-3 text-sm text-parchment-muted">
      <button type="button" className="btn-ghost btn-sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span aria-live="polite">Page {page} of {pages}</span>
      <button type="button" className="btn-ghost btn-sm" disabled={page >= pages || busy} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

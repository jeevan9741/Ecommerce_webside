"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { listQuery, pageCount } from "@/lib/franchise-partner-views";

export interface Column<Row> {
  header: string;
  cell: (row: Row) => React.ReactNode;
  className?: string;
}

interface Props<Row> {
  /** A partner API list endpoint, e.g. "/franchise-partner/enrolments". The server scopes it to this franchise. */
  endpoint: string;
  /** Key of the rows array in the response, e.g. "enrolments". */
  rowsKey: string;
  title: string;
  searchPlaceholder: string;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  emptyText: string;
}

interface Page<Row> {
  page: number;
  pageSize: number;
  total: number;
  rows: Row[];
}

/** A searchable, paginated table over one of the franchise's own lists, with loading, empty and error states. */
export function PartnerTable<Row>({ endpoint, rowsKey, title, searchPlaceholder, columns, rowKey, emptyText }: Props<Row>) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  // The latest finished request; the table keeps showing it while the next one loads.
  const [result, setResult] = useState<{ key: string; data?: Page<Row>; error?: string } | null>(null);
  const key = `${applied}\u0000${page}\u0000${attempt}`;

  useEffect(() => {
    let live = true;
    api.get<Record<string, unknown> & { page: number; pageSize: number; total: number }>(`${endpoint}${listQuery(applied, page)}`).then(
      (r) => live && setResult({ key, data: { page: r.page, pageSize: r.pageSize, total: r.total, rows: (r[rowsKey] as Row[]) ?? [] } }),
      (e) => live && setResult((prev) => ({ key, data: prev?.data, error: e instanceof Error ? e.message : "Something went wrong. Please try again." }))
    );
    return () => {
      live = false;
    };
  }, [endpoint, rowsKey, key, applied, page]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const loading = result?.key !== key;
  const data = result?.data ?? null;
  const error = !loading ? (result?.error ?? null) : null;
  const pages = data ? pageCount(data.total, data.pageSize) : 1;

  return (
    <section className="card" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="font-display text-lg font-semibold text-parchment">
          {title} {data ? <span className="text-sm font-normal text-parchment-muted">({data.total})</span> : null}
        </h2>
        <form
          className="flex w-full gap-2 sm:w-auto"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(q.trim());
          }}
        >
          <input aria-label={searchPlaceholder} className="input-field text-sm sm:!w-64" placeholder={searchPlaceholder} value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="btn-outline btn-sm" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="m-5 rounded-lg border border-danger/40 p-3 text-sm text-danger">
          {error}{" "}
          <button type="button" className="underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={`px-5 py-2 font-medium ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-white/5">
                {columns.map((c) => (
                  <td key={c.header} className={`px-5 py-2.5 align-top ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && !data && (
        <p className="flex items-center gap-2 p-5 text-sm text-parchment-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      )}
      {data && data.rows.length === 0 && !error && <p className="p-5 text-sm text-parchment-muted">{applied ? "Nothing matches your search." : emptyText}</p>}

      {data && pages > 1 && (
        <nav className="flex items-center justify-between gap-3 border-t border-white/5 px-5 py-3 text-sm" aria-label={`${title} pages`}>
          <button type="button" className="btn-ghost btn-sm inline-flex items-center gap-1" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
          </button>
          <span className="text-parchment-muted">
            Page {data.page} of {pages}
          </span>
          <button type="button" className="btn-ghost btn-sm inline-flex items-center gap-1" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
}

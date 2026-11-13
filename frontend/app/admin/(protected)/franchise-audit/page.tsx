"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AdminPager } from "@/components/franchise/admin-pager";

interface Entry {
  id: string;
  action: string;
  target: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { name: string; role: string } | null;
}
interface AuditResponse {
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  entries: Entry[];
}
type Filters = { action: string; target: string; from: string; to: string; page: number };

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
/** FRANCHISE_STATE_RESERVED → "State reserved" (the code itself is shown alongside). */
const actionLabel = (a: string) => {
  const words = a.replace(/^(FRANCHISE|POLICY)_/, "").toLowerCase().split("_");
  return words.join(" ").replace(/^./, (c) => c.toUpperCase());
};
const query = (f: Filters) => {
  const p = new URLSearchParams();
  for (const k of ["action", "target", "from", "to"] as const) if (f[k]) p.set(k, f[k]);
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Read-only franchise and franchise-policy audit history, newest first. Entries can't be edited or removed here. */
export default function FranchiseAuditPage() {
  const [filters, setFilters] = useState<Filters>({ action: "", target: "", from: "", to: "", page: 1 });
  const [target, setTarget] = useState("");
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<AuditResponse>(`/admin/franchise/audit${query(filters)}`)
      .then(
        (r) => live && (setData(r), setError(null)),
        (e) => live && setError(message(e))
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filters]);
  const set = (patch: Partial<Filters>) => {
    setLoading(true);
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Audit History</h1>
        <p className="mt-1 text-sm text-parchment-muted">Every recorded franchise action: who did it, when, and to what. This history is read-only.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <form
        className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_auto_auto_auto]"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ target: target.trim() });
        }}
      >
        <div>
          <label className="label-field" htmlFor="audit-action">Action</label>
          <select id="audit-action" value={filters.action} onChange={(e) => set({ action: e.target.value })} className="input-field">
            <option value="">All actions</option>
            {data?.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="label-field" htmlFor="audit-target">Record id</label>
          <input id="audit-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={60} className="input-field" placeholder="Exact id (optional)" />
        </div>
        <div>
          <label className="label-field" htmlFor="audit-from">From</label>
          <input id="audit-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="input-field" />
        </div>
        <div>
          <label className="label-field" htmlFor="audit-to">To</label>
          <input id="audit-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="input-field" />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-outline w-full">Apply</button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">By</th>
              <th className="px-4 py-3 font-medium">Record</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id} className="border-t border-white/5 align-top">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-parchment-muted">{formatDateTime(e.createdAt)}</td>
                <td className="px-4 py-3">
                  <p className="text-parchment">{actionLabel(e.action)}</p>
                  <p className="font-mono text-[11px] text-parchment-muted">{e.action}</p>
                  {e.metadata != null && (
                    <button type="button" className="mt-1 text-xs text-gold-400 hover:underline" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {open === e.id ? "Hide details" : "Details"}
                    </button>
                  )}
                  {open === e.id && <pre className="mt-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/20 p-2 text-[11px] text-parchment-muted">{JSON.stringify(e.metadata, null, 2)}</pre>}
                </td>
                <td className="px-4 py-3 text-xs text-parchment">{e.actor ? `${e.actor.name} (${e.actor.role.toLowerCase()})` : "System"}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-parchment-muted">{e.target ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="flex items-center gap-2 p-4 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {!loading && data?.entries.length === 0 && <p className="p-4 text-sm text-parchment-muted">No audit entries match these filters.</p>}
        {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} busy={loading} onPage={(page) => { setLoading(true); setFilters((f) => ({ ...f, page })); }} />}
      </div>
    </div>
  );
}

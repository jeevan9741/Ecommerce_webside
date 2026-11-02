"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { REVIEW_STATUSES, STATUS_LABEL, listQuery, pageCount } from "@/lib/franchise-review";
import { StatusBadge } from "@/components/franchise/status-badge";

interface Row {
  id: string;
  applicationNo: string;
  applicantName: string;
  state: string;
  district: string;
  status: string;
  statusLabel: string;
  submittedAt: string;
}
interface ListResponse {
  page: number;
  pageSize: number;
  total: number;
  applications: Row[];
}
interface Location {
  id: string;
  name: string;
  districts: { id: string; name: string }[];
}
interface Filters {
  status: string;
  q: string;
  stateId: string;
  districtId: string;
  from: string;
  to: string;
  page: number;
}

const PAGE_SIZE = 25;
const EMPTY: Filters = { status: "", q: "", stateId: "", districtId: "", from: "", to: "", page: 1 };
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** Admin list of franchise applications: minimal fields only; contact details are in the (audited) detail view. */
export default function FranchiseApplicationsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ counts: Record<string, number> }>("/admin/franchise/applications/summary").then((r) => setCounts(r.counts), (e) => setError(message(e)));
    api.get<{ states: Location[] }>("/admin/franchise/locations").then((r) => setLocations(r.states), () => setLocations([]));
  }, []);

  useEffect(() => {
    let live = true;
    api
      .get<ListResponse>(`/admin/franchise/applications${listQuery({ ...filters, pageSize: PAGE_SIZE })}`)
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
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  };
  const districts = useMemo(() => locations.find((s) => s.id === filters.stateId)?.districts ?? [], [locations, filters.stateId]);
  const pages = data ? pageCount(data.total, data.pageSize) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Applications</h1>
        <p className="mt-1 text-sm text-parchment-muted">Review applications and record decisions. Approving doesn&apos;t reserve or allocate a district.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {[["", "All"], ...REVIEW_STATUSES.map((s) => [s, STATUS_LABEL[s]])].map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            role="tab"
            aria-selected={filters.status === value}
            onClick={() => set({ status: value })}
            className={`rounded-full border px-3 py-1 text-xs ${filters.status === value ? "border-gold-500 bg-gold-500/15 text-parchment" : "border-white/10 text-parchment-muted hover:text-parchment"}`}
          >
            {label}
            {counts && <span className="ml-1.5 opacity-70">{value ? (counts[value] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0)}</span>}
          </button>
        ))}
      </div>

      <form
        className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() });
        }}
      >
        <div className="sm:col-span-2">
          <label htmlFor="q" className="label-field">Search</label>
          <div className="flex gap-2">
            <input id="q" className="input-field text-sm" placeholder="Application no., name, email or mobile" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
            <button type="submit" className="btn-outline btn-sm" aria-label="Search"><Search className="h-4 w-4" /></button>
          </div>
        </div>
        <div>
          <label htmlFor="state" className="label-field">State / UT</label>
          <select id="state" className="input-field text-sm" value={filters.stateId} onChange={(e) => set({ stateId: e.target.value, districtId: "" })}>
            <option value="">All</option>
            {locations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="district" className="label-field">District</label>
          <select id="district" className="input-field text-sm" value={filters.districtId} disabled={!filters.stateId} onChange={(e) => set({ districtId: e.target.value })}>
            <option value="">All</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="label-field">Submitted from</label>
          <input id="from" type="date" className="input-field text-sm" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="to" className="label-field">Submitted to</label>
          <input id="to" type="date" className="input-field text-sm" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </form>

      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Applicant</th>
              <th className="px-4 py-3 font-medium">District</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {data?.applications.map((a) => (
              <tr key={a.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-3">
                  <Link href={`/admin/franchise-applications/${a.id}`} className="font-medium text-parchment underline-offset-2 hover:underline">{a.applicationNo}</Link>
                </td>
                <td className="px-4 py-3 text-parchment">{a.applicantName}</td>
                <td className="px-4 py-3 text-parchment-muted">{a.district}, {a.state}</td>
                <td className="px-4 py-3"><StatusBadge status={a.status} label={a.statusLabel} /></td>
                <td className="px-4 py-3 text-parchment-muted">{formatDateTime(a.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="flex items-center gap-2 p-4 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {!loading && data?.applications.length === 0 && <p className="p-4 text-sm text-parchment-muted">No applications match these filters.</p>}
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-parchment-muted">
          <span>
            {data.total} application{data.total === 1 ? "" : "s"} · page {data.page} of {pages}
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={data.page <= 1 || loading} onClick={() => set({ page: data.page - 1 })} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="btn-ghost btn-sm" disabled={data.page >= pages || loading} onClick={() => set({ page: data.page + 1 })} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      )}
    </div>
  );
}

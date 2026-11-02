"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AWAITING_LABEL, CATEGORY_LABEL, TICKET_CATEGORIES, TICKET_STATUSES, TICKET_STATUS_LABEL, type TicketRow } from "@/lib/franchise-tickets";

interface ListResponse {
  total: number;
  awaitingEta: number;
  tickets: TicketRow[];
}

/** Every franchise's support tickets, newest activity first. */
export default function FranchiseTicketsAdminPage() {
  const [filters, setFilters] = useState({ status: "", category: "", awaiting: "", q: "" });
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    api.get<ListResponse>(`/admin/franchise/tickets${p.toString() ? `?${p}` : ""}`).then(setData, (e) => setError(e instanceof Error ? e.message : "Something went wrong."));
  }, [filters]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Tickets</h1>
        <p className="mt-1 text-sm text-parchment-muted">{data ? `${data.awaitingEta} waiting for ETA.` : " "}</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}
      <div className="card grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <label htmlFor="f-status" className="label-field">Status</label>
          <select id="f-status" className="input-field text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-category" className="label-field">Category</label>
          <select id="f-category" className="input-field text-sm" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            <option value="">All</option>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-awaiting" className="label-field">Waiting for</label>
          <select id="f-awaiting" className="input-field text-sm" value={filters.awaiting} onChange={(e) => setFilters({ ...filters, awaiting: e.target.value })}>
            <option value="">Anyone</option>
            <option value="ETA">ETA</option>
            <option value="PARTNER">Franchise</option>
          </select>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...filters, q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
          }}
        >
          <label htmlFor="f-q" className="label-field">Search</label>
          <input id="f-q" name="q" className="input-field text-sm" placeholder="Ticket no., subject, franchise code" maxLength={100} />
        </form>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Franchise</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {data?.tickets.map((t) => (
              <tr key={t.id} className="border-t border-white/5">
                <td className="px-4 py-3"><Link href={`/admin/franchise-tickets/${t.id}`} className="font-medium text-parchment hover:underline">{t.ticketNo}</Link><p className="text-xs text-parchment-muted">{t.subject}</p></td>
                <td className="px-4 py-3 text-parchment-muted">{t.franchiseCode}</td>
                <td className="px-4 py-3 text-parchment-muted">{CATEGORY_LABEL[t.category]}</td>
                <td className="px-4 py-3 text-parchment">{TICKET_STATUS_LABEL[t.status]}<p className="text-xs text-parchment-muted">{AWAITING_LABEL[t.awaiting]}</p></td>
                <td className="px-4 py-3 text-parchment-muted">{formatDateTime(t.lastMessageAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && !error && <p className="flex items-center gap-2 p-4 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {data?.tickets.length === 0 && <p className="p-4 text-sm text-parchment-muted">No tickets match.</p>}
      </div>
    </div>
  );
}

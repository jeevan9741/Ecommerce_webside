"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PartnerStatus } from "@/components/franchise/partner-status";
import { AdminPager } from "@/components/franchise/admin-pager";

const PAGE_SIZE = 25;

interface Row {
  id: string;
  franchiseCode: string;
  status: string;
  ownerName: string;
  district: string;
  state: string;
  agreementStartsAt: string;
  agreementEndsAt: string;
}

/** Active and past franchise partners. Partners are created only by activation (after payment and agreement). */
export default function FranchisePartnersPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    api.get<{ partners: Row[] }>("/admin/franchise/partners").then((r) => setRows(r.partners), (e) => setError(e instanceof Error ? e.message : "Something went wrong."));
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter(
    (p) => (!status || p.status === status) && (!needle || [p.franchiseCode, p.ownerName, p.state, p.district].some((v) => v.toLowerCase().includes(needle)))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Partners</h1>
        <p className="mt-1 text-sm text-parchment-muted">Suspending takes effect at once; reinstating or deactivating needs a second admin.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}
      <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto]" role="search">
        <div>
          <label className="label-field" htmlFor="partner-q">Search</label>
          <input id="partner-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} maxLength={100} className="input-field" placeholder="Franchise code, owner or state" />
        </div>
        <div>
          <label className="label-field" htmlFor="partner-status">Status</label>
          <select id="partner-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input-field">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DEACTIVATED">Deactivated</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Franchise</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">State · training centre</th>
              <th className="px-4 py-3 font-medium">Agreement</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="px-4 py-3"><Link href={`/admin/franchise-partners/${p.id}`} className="font-medium text-parchment hover:underline">{p.franchiseCode}</Link></td>
                <td className="px-4 py-3 text-parchment">{p.ownerName}</td>
                <td className="px-4 py-3 text-parchment-muted">{p.state} · {p.district}</td>
                <td className="px-4 py-3 text-parchment-muted">{formatDate(p.agreementStartsAt)} – {formatDate(p.agreementEndsAt)}</td>
                <td className="px-4 py-3"><PartnerStatus status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows && !error && <p className="flex items-center gap-2 p-4 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {rows && rows.length > 0 && shown.length === 0 && <p className="p-4 text-sm text-parchment-muted">No partners match these filters.</p>}
        <AdminPager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
        {rows?.length === 0 && <p className="p-4 text-sm text-parchment-muted">No franchise partners yet. Partners appear here once an approved, paid application with an accepted agreement is activated.</p>}
      </div>
    </div>
  );
}

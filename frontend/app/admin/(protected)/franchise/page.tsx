"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { franchiseDemoData } from "@/lib/feature-flags";

interface Overview {
  states: { total: number; enabled: number; available: number; reserved: number; closed: number };
  applications: Record<string, number>;
  partners: { active: number; suspended: number; deactivated: number; expired: number };
  tickets: { open: number; inProgress: number };
  pending: { reopenRequests: number; partnerRequests: number; assignmentRequests: number };
  systems: { key: string; label: string; available: false; message: string }[];
}

const APPLICATION_LABEL: Record<string, string> = {
  APPLICATION_SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  INTERVIEW_DISCUSSION: "Interview / discussion",
  APPROVED: "Approved",
  PAYMENT_PENDING: "Payment pending",
  AGREEMENT_PENDING: "Agreement pending",
  ACTIVE_FRANCHISE: "Active franchise",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** Franchise Management at a glance — every number is read from existing records by the backend. */
export default function FranchiseOverviewPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<Overview>("/admin/franchise/overview").then(setO, (e) => setError(e instanceof Error ? e.message : "Something went wrong."));
  }, []);

  if (!o) {
    return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  }
  const apps = Object.entries(APPLICATION_LABEL).map(([k, label]) => ({ k, label, n: o.applications[k] ?? 0 }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Overview</h1>
        <p className="mt-1 text-sm text-parchment-muted">Figures come straight from the franchise records. Nothing is estimated.</p>
      </div>
      {franchiseDemoData() && (
        <p role="note" className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4 text-sm font-semibold text-parchment">
          Local preview: these records are synthetic test data, not real business figures.
        </p>
      )}

      <section aria-labelledby="ov-states">
        <h2 id="ov-states" className="font-display text-lg font-semibold text-parchment">States</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total states" value={o.states.total} note={`${o.states.enabled} enabled for applications`} href="/admin/franchise-states" />
          <Stat label="Available" value={o.states.available} href="/admin/franchise-states" />
          <Stat label="Reserved" value={o.states.reserved} note="Temporary admin reservations" href="/admin/franchise-states" />
          <Stat label="Closed" value={o.states.closed} note="Held by a franchise (active or suspended)" href="/admin/franchise-states" />
        </div>
      </section>

      <section aria-labelledby="ov-partners">
        <h2 id="ov-partners" className="font-display text-lg font-semibold text-parchment">Partners and work queues</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Active partners" value={o.partners.active} href="/admin/franchise-partners" />
          <Stat label="Suspended partners" value={o.partners.suspended} note={`${o.partners.deactivated} deactivated · ${o.partners.expired} expired`} href="/admin/franchise-partners" />
          <Stat label="Pending support tickets" value={o.tickets.open + o.tickets.inProgress} note={`${o.tickets.open} open · ${o.tickets.inProgress} in progress`} href="/admin/franchise-tickets" />
          <Stat label="Pending reopening requests" value={o.pending.reopenRequests} note={`${o.pending.partnerRequests} partner and ${o.pending.assignmentRequests} student-assignment requests also await a second admin`} href="/admin/franchise-states" />
        </div>
      </section>

      <section aria-labelledby="ov-apps" className="card p-6">
        <h2 id="ov-apps" className="font-display text-lg font-semibold text-parchment">Applications by status</h2>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((a) => (
            <li key={a.k}>
              <Link href={`/admin/franchise-applications?status=${a.k}`} className="flex justify-between gap-3 rounded-lg border border-white/5 px-3 py-2 hover:border-white/15">
                <span className="text-parchment-muted">{a.label}</span>
                <span className="font-semibold text-parchment">{a.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ov-systems" className="card p-6">
        <h2 id="ov-systems" className="font-display text-lg font-semibold text-parchment">Payment, agreement and payouts</h2>
        <p className="mt-1 text-xs text-parchment-muted">Final franchise activation stays disabled until these exist.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {o.systems.map((s) => (
            <li key={s.key} className="flex flex-wrap justify-between gap-2 rounded-lg border border-white/5 px-3 py-2">
              <span className="text-parchment">{s.label}</span>
              <span className="text-parchment-muted">{s.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, note, href }: { label: string; value: number; note?: string; href: string }) {
  return (
    <Link href={href} className="card card-hover block p-5">
      <p className="text-xs uppercase tracking-wide text-parchment-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-parchment">{value}</p>
      {note && <p className="mt-1 text-xs text-parchment-muted">{note}</p>}
    </Link>
  );
}

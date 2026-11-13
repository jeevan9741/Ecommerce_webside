"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AdminPager } from "@/components/franchise/admin-pager";

const PAGE_SIZE = 25;
/** Public availability groups for the filter (from the backend's workflow status). */
const AVAILABILITY_OF: Record<string, "AVAILABLE" | "RESERVED" | "CLOSED"> = {
  ACTIVATED_CLOSED: "CLOSED",
  SUSPENDED: "CLOSED",
};

/** The workflow statuses the backend derives for each state (one primary franchise per state). */
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  APPLICATION_UNDER_REVIEW: "Application under review",
  APPROVED_AWAITING_PAYMENT: "Approved — awaiting payment",
  PAYMENT_VERIFIED_AWAITING_AGREEMENT: "Payment verified — awaiting agreement",
  AGREEMENT_PENDING: "Agreement pending",
  ACTIVATED_CLOSED: "Activated / closed",
  SUSPENDED: "Suspended (still held)",
  REOPENED_AVAILABLE: "Reopened / available",
};
const STATUS_TONE: Record<string, string> = {
  AVAILABLE: "border-emerald/40 text-emerald",
  REOPENED_AVAILABLE: "border-emerald/40 text-emerald",
  ACTIVATED_CLOSED: "border-white/20 text-parchment",
  SUSPENDED: "border-danger/40 text-danger",
};

interface StateRow {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  status: string;
  holding: { allocationId: string; status: string; reservedUntil: string | null; allocatedAt: string | null; suspendedAt: string | null } | null;
  application: { id: string; applicationNo: string; status: string } | null;
  partner: { id: string; franchiseCode: string; status: string } | null;
  applications: Record<string, number>;
}
interface ReopenRequest {
  id: string;
  targetId: string;
  status: string;
  reason: string;
  payloadSha256: string;
  requestedById: string;
  createdAt: string;
  expiresAt: string;
  state?: string | null;
}
interface History {
  state: { id: string; name: string };
  allocations: { id: string; status: string; application: { applicationNo: string } | null; partner: { franchiseCode: string; status: string } | null; events: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string }[] }[];
  applications: { id: string; applicationNo: string; applicantName: string; status: string; submittedAt: string }[];
  audit: { id: string; action: string; createdAt: string }[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchAll = () =>
  Promise.all([
    api.get<{ states: StateRow[] }>("/admin/franchise/states").then((r) => r.states),
    api.get<{ requests: ReopenRequest[] }>("/admin/franchise/state-reopen-requests").then((r) => r.requests.filter((x) => x.status === "PENDING")),
  ]);

/**
 * State availability for the franchise programme. A state closes only when a franchise is activated
 * there; it is reopened only through a two-admin request once the holding franchise is deactivated or
 * expired. Every action is checked, recorded and audited by the backend.
 */
export default function FranchiseStatesPage() {
  const [states, setStates] = useState<StateRow[] | null>(null);
  const [requests, setRequests] = useState<ReopenRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [availability, setAvailability] = useState("");
  const [page, setPage] = useState(1);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const apply = useCallback(([s, r]: [StateRow[], ReopenRequest[]]) => {
    setStates(s);
    setRequests(r);
    setError(null);
  }, []);
  const load = useCallback(() => fetchAll().then(apply, (err) => setError(message(err))), [apply]);
  useEffect(() => {
    fetchAll().then(apply, (err) => setError(message(err)));
  }, [apply]);

  const done = async (msg: string) => {
    setNotice(msg);
    await load();
  };

  if (!states) {
    return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  }
  const availabilityOf = (s: StateRow) => AVAILABILITY_OF[s.status] ?? (s.holding?.status === "RESERVED" ? "RESERVED" : "AVAILABLE");
  const shown = states.filter((s) => (!filter || s.name.toLowerCase().includes(filter.toLowerCase())) && (!availability || availabilityOf(s) === availability));
  const closed = states.filter((s) => s.status === "ACTIVATED_CLOSED" || s.status === "SUSPENDED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise States</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          One primary franchise per state. {closed} of {states.length} states are held by a franchise. Applications alone never close a state.
        </p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <ReopenRequests requests={requests} states={states} onDone={done} />

      <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]" role="search">
        <div>
          <label className="label-field" htmlFor="state-filter">Find a state</label>
          <input id="state-filter" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="input-field" placeholder="State name" />
        </div>
        <div>
          <label className="label-field" htmlFor="state-availability">Availability</label>
          <select id="state-availability" value={availability} onChange={(e) => { setAvailability(e.target.value); setPage(1); }} className="input-field">
            <option value="">All</option>
            <option value="AVAILABLE">Available</option>
            <option value="RESERVED">Reserved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div className="flex items-end">
          <Link href="/admin/franchise-locations" className="btn-outline w-full">States &amp; districts setup</Link>
        </div>
      </div>

      {states.length === 0 ? (
        <p className="card p-6 text-sm text-parchment-muted">No states are set up yet. Add them on the Franchise Locations page.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-parchment-muted">
              <tr>
                <th className="p-3">State</th>
                <th className="p-3">Status</th>
                <th className="p-3">Application / partner</th>
                <th className="p-3">Applications</th>
                <th className="p-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => (
                <StateRowView key={s.id} s={s} openHistory={() => setHistoryFor(historyFor === s.id ? null : s.id)} historyOpen={historyFor === s.id} hasRequest={requests.some((r) => r.targetId === s.id)} onDone={done} />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-4 text-sm text-parchment-muted">No states match these filters.</p>}
          <AdminPager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

function StateRowView({ s, openHistory, historyOpen, hasRequest, onDone }: { s: StateRow; openHistory: () => void; historyOpen: boolean; hasRequest: boolean; onDone: (m: string) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const open = Object.entries(s.applications).filter(([k]) => !["REJECTED", "WITHDRAWN"].includes(k)).reduce((n, [, v]) => n + v, 0);
  const canAskReopen = (s.status === "ACTIVATED_CLOSED" || s.status === "SUSPENDED") && !hasRequest;
  return (
    <>
      <tr>
        <td className="p-3">
          <p className="font-semibold text-parchment">{s.name}</p>
          {!s.isActive && <p className="text-xs text-parchment-muted">Disabled</p>}
        </td>
        <td className="p-3">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status] ?? "border-amber-500/50 text-amber-400"}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
          {s.holding?.status === "RESERVED" && s.holding.reservedUntil && <p className="mt-1 text-xs text-parchment-muted">Reserved until {formatDateTime(s.holding.reservedUntil)}</p>}
        </td>
        <td className="p-3 text-xs">
          {s.application && <Link href={`/admin/franchise-applications/${s.application.id}`} className="block text-gold-400 hover:underline">{s.application.applicationNo}</Link>}
          {s.partner && <Link href={`/admin/franchise-partners/${s.partner.id}`} className="block text-gold-400 hover:underline">{s.partner.franchiseCode} ({s.partner.status.toLowerCase()})</Link>}
          {!s.application && !s.partner && <span className="text-parchment-muted">—</span>}
        </td>
        <td className="p-3 text-xs text-parchment-muted">{open} open</td>
        <td className="p-3 text-right">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={openHistory} aria-expanded={historyOpen}>History</button>
            {canAskReopen && <button type="button" className="btn-outline btn-sm" onClick={() => setAsking(!asking)}>Request reopen</button>}
          </div>
        </td>
      </tr>
      {asking && (
        <tr>
          <td colSpan={5} className="p-3">
            <ReopenForm state={s} onDone={async (m) => { setAsking(false); await onDone(m); }} onCancel={() => setAsking(false)} />
          </td>
        </tr>
      )}
      {historyOpen && (
        <tr>
          <td colSpan={5} className="p-3">
            <StateHistory stateId={s.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function ReopenForm({ state, onDone, onCancel }: { state: StateRow; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters.");
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/franchise/states/${encodeURIComponent(state.id)}/reopen-requests`, { reason: reason.trim() });
      await onDone(`Reopen request for ${state.name} created. A different admin must approve it.`);
    } catch (err) {
      setError(err instanceof ApiError && err.data.code === "FRANCHISE_RIGHTS_ACTIVE" ? "The franchise holding this state still has active or suspended rights. Deactivate it first (two-admin action); a suspension never reopens a state." : message(err));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-white/10 p-4" role="dialog" aria-label={`Request to reopen ${state.name}`}>
      <p className="text-sm text-parchment">
        Reopening makes {state.name} available to new applicants. It is allowed only when the holding franchise has been deactivated or its agreement has ended,
        and a second admin must approve it.
      </p>
      <label className="label-field" htmlFor={`reopen-${state.id}`}>Reason (recorded in the audit log)</label>
      <textarea id={`reopen-${state.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="input-field resize-none" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-gold btn-sm" disabled={busy} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" /> : "Create request"}</button>
        <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ReopenRequests({ requests, states, onDone }: { requests: ReopenRequest[]; states: StateRow[]; onDone: (m: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (requests.length === 0) return null;
  const name = (id: string) => states.find((s) => s.id === id)?.name ?? "Unknown state";
  async function act(r: ReopenRequest, action: "approve" | "reject" | "cancel") {
    setBusy(r.id);
    setError(null);
    try {
      await api.post(`/admin/franchise/state-reopen-requests/${encodeURIComponent(r.id)}/${action}`, action === "approve" ? { expectedPayloadSha: r.payloadSha256 } : {});
      await onDone(action === "approve" ? `${name(r.targetId)} reopened.` : `Request ${action === "reject" ? "rejected" : "cancelled"}.`);
    } catch (err) {
      setError(err instanceof ApiError && err.data.code === "SAME_ADMIN" ? "A different admin must decide this request." : message(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">Reopen requests awaiting a second admin</h2>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="text-parchment">{name(r.targetId)}</p>
              <p className="text-xs text-parchment-muted">{r.reason}</p>
              <p className="text-xs text-parchment-muted">Requested {formatDateTime(r.createdAt)} · expires {formatDateTime(r.expiresAt)}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-gold btn-sm" disabled={busy === r.id} onClick={() => act(r, "approve")}>Approve</button>
              <button type="button" className="btn-ghost btn-sm text-danger" disabled={busy === r.id} onClick={() => act(r, "reject")}>Reject</button>
              <button type="button" className="btn-outline btn-sm" disabled={busy === r.id} onClick={() => act(r, "cancel")}>Cancel mine</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StateHistory({ stateId }: { stateId: string }) {
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<History>(`/admin/franchise/states/${encodeURIComponent(stateId)}/history`).then(setH, (err) => setError(message(err)));
  }, [stateId]);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!h) return <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>;
  const events = h.allocations
    .flatMap((a) => a.events.map((e) => ({ ...e, who: a.partner?.franchiseCode ?? a.application?.applicationNo ?? "—" })))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <div className="grid gap-4 rounded-lg border border-white/10 p-4 text-xs sm:grid-cols-2">
      <div>
        <p className="font-semibold text-parchment">Allocation history</p>
        {events.length === 0 ? <p className="mt-1 text-parchment-muted">This state has never been reserved or allocated.</p> : (
          <ol className="mt-2 space-y-2">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-white/10 pl-2">
                <p className="text-parchment">{e.fromStatus ? `${e.fromStatus} → ` : ""}{e.toStatus} · {e.who}</p>
                <p className="text-parchment-muted">{formatDateTime(e.createdAt)}{e.reason ? ` · ${e.reason}` : ""}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <p className="font-semibold text-parchment">Applications</p>
        {h.applications.length === 0 ? <p className="mt-1 text-parchment-muted">None.</p> : (
          <ul className="mt-2 space-y-1">
            {h.applications.map((a) => (
              <li key={a.id}><Link href={`/admin/franchise-applications/${a.id}`} className="text-gold-400 hover:underline">{a.applicationNo}</Link> <span className="text-parchment-muted">· {a.status} · {formatDateTime(a.submittedAt)}</span></li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-semibold text-parchment">Audit log</p>
        {h.audit.length === 0 ? <p className="mt-1 text-parchment-muted">No entries.</p> : (
          <ul className="mt-2 space-y-1">
            {h.audit.slice(0, 20).map((a) => <li key={a.id} className="text-parchment-muted">{a.action} · {formatDateTime(a.createdAt)}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

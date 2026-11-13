"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";
import { Modal } from "@/components/admin/modal";
import { AdminPager } from "@/components/franchise/admin-pager";
import { PartnerStatus } from "@/components/franchise/partner-status";

interface Assignment {
  id: string;
  status: "ACTIVE" | "ENDED";
  source: string;
  startsAt: string;
  endsAt: string | null;
  endReason: string | null;
  student: { id: string; name: string; email: string };
  partner: { id: string; franchiseCode: string; status: string; state: string };
}
interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  assignments: Assignment[];
}
interface PartnerOption {
  id: string;
  franchiseCode: string;
  status: string;
  state: string;
}
type Filters = { status: "" | "ACTIVE" | "ENDED"; partnerId: string; q: string; page: number };

const SOURCE_LABEL: Record<string, string> = { INVITE_ACCEPTED: "Student accepted an invite", ADMIN_REASSIGNMENT: "Admin reassignment" };
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const query = (f: Filters) => {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.partnerId) p.set("partnerId", f.partnerId);
  if (f.q) p.set("q", f.q);
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/**
 * Admin-only view of which franchise each student belongs to. New assignments are made only when a
 * student accepts a franchise's invite; here an admin can move a student to another franchise or end
 * an assignment, always with a reason. Ended assignments stay listed as history.
 */
export default function FranchiseAssignmentsPage() {
  // A franchise in the address (from a partner's page) pre-selects that filter.
  const initialPartner = useSearchParams().get("partnerId") ?? "";
  const [filters, setFilters] = useState<Filters>({ status: "ACTIVE", partnerId: initialPartner.slice(0, 40), q: "", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<{ mode: "reassign" | "end"; row: Assignment } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api.get<{ partners: PartnerOption[] }>("/admin/franchise/partners").then((r) => setPartners(r.partners), () => setPartners([]));
  }, []);
  useEffect(() => {
    let live = true;
    api
      .get<ListResponse>(`/admin/franchise/student-assignments${query(filters)}`)
      .then(
        (r) => live && (setData(r), setError(null)),
        (e) => live && setError(message(e))
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filters, reloadKey]);

  const set = (patch: Partial<Filters>) => {
    setLoading(true);
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Student Assignments</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Which franchise each student belongs to. Students join a franchise only by accepting its invite. Moving a student to another franchise, or ending an assignment, needs two admins: one asks, with a reason, and a different admin approves. Every change is recorded.
        </p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <ReassignRequests
        reloadKey={reloadKey}
        onDone={(msg) => {
          setNotice(msg);
          setLoading(true);
          setReloadKey((k) => k + 1);
        }}
      />

      <form
        className="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto]"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: search.trim() });
        }}
      >
        <div>
          <label className="label-field" htmlFor="assign-q">Search</label>
          <input id="assign-q" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} className="input-field" placeholder="Student name, email or franchise code" />
        </div>
        <div>
          <label className="label-field" htmlFor="assign-status">Status</label>
          <select id="assign-status" value={filters.status} onChange={(e) => set({ status: e.target.value as Filters["status"] })} className="input-field">
            <option value="ACTIVE">Active</option>
            <option value="ENDED">Ended (history)</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label className="label-field" htmlFor="assign-partner">Franchise</label>
          <select id="assign-partner" value={filters.partnerId} onChange={(e) => set({ partnerId: e.target.value })} className="input-field">
            <option value="">All franchises</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.franchiseCode} · {p.state}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-outline w-full"><Search className="h-4 w-4" aria-hidden="true" /> Search</button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Franchise</th>
              <th className="px-4 py-3 font-medium">Assignment</th>
              <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.assignments.map((a) => (
              <tr key={a.id} className="border-t border-white/5 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-parchment">{a.student.name}</p>
                  <p className="text-xs text-parchment-muted">{a.student.email}</p>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/franchise-partners/${a.partner.id}`} className="font-medium text-parchment hover:underline">{a.partner.franchiseCode}</Link>
                  <p className="text-xs text-parchment-muted">{a.partner.state}</p>
                  <div className="mt-1"><PartnerStatus status={a.partner.status} /></div>
                </td>
                <td className="px-4 py-3 text-xs text-parchment-muted">
                  <p className={a.status === "ACTIVE" ? "font-semibold text-emerald" : "font-semibold text-parchment-muted"}>{a.status === "ACTIVE" ? "Active" : "Ended"}</p>
                  <p>Since {formatDateTime(a.startsAt)} · {SOURCE_LABEL[a.source] ?? a.source}</p>
                  {a.endsAt && <p>Ended {formatDateTime(a.endsAt)}{a.endReason ? ` · ${a.endReason}` : ""}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  {a.status === "ACTIVE" && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="btn-outline btn-sm" onClick={() => setActing({ mode: "reassign", row: a })}>Reassign</button>
                      <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setActing({ mode: "end", row: a })}>End</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="flex items-center gap-2 p-4 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {!loading && data?.assignments.length === 0 && <p className="p-4 text-sm text-parchment-muted">No assignments match these filters.</p>}
        {data && <AdminPager page={data.page} pageSize={data.pageSize} total={data.total} busy={loading} onPage={(page) => { setLoading(true); setFilters((f) => ({ ...f, page })); }} />}
      </div>

      {acting && (
        <AssignmentDialog
          mode={acting.mode}
          row={acting.row}
          partners={partners.filter((p) => p.status === "ACTIVE" && p.id !== acting.row.partner.id)}
          onClose={() => setActing(null)}
          onDone={(msg) => {
            setActing(null);
            setNotice(msg);
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function AssignmentDialog({ mode, row, partners, onClose, onDone }: { mode: "reassign" | "end"; row: Assignment; partners: PartnerOption[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "reassign" && !target) return setError("Choose the franchise to move the student to.");
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters; it is recorded in the audit history.");
    if (!confirmed) return setError("Tick the confirmation box to continue.");
    setBusy(true);
    setError(null);
    try {
      const base = `/admin/franchise/student-assignments/${encodeURIComponent(row.id)}`;
      if (mode === "reassign") {
        await api.post(`${base}/reassign-requests`, { targetPartnerId: target, expectedPartnerId: row.partner.id, reason: reason.trim() });
        onDone(`Request to move ${row.student.name} to ${partners.find((p) => p.id === target)?.franchiseCode ?? "the new franchise"} created. A different admin must approve it before anything changes.`);
      } else {
        await api.post(`${base}/end-requests`, { expectedPartnerId: row.partner.id, reason: reason.trim() });
        onDone(`Request to end ${row.student.name}'s assignment to ${row.partner.franchiseCode} created. A different admin must approve it before anything changes.`);
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.data.code === "STALE"
          ? "This assignment changed since you opened it. Close this and reload."
          : err instanceof ApiError && err.data.code === "REQUEST_EXISTS"
            ? "This student already has an open request. Approve, reject or cancel it first."
            : message(err)
      );
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "reassign" ? "Request reassignment" : "Request to end assignment"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-parchment">
          {row.student.name} is assigned to <strong>{row.partner.franchiseCode}</strong>.{" "}
          {mode === "reassign"
            ? "This creates a request only. Nothing changes until a different admin approves it; then the current assignment ends (kept as history) and a new one starts with the franchise you choose."
            : "This creates a request only. Nothing changes until a different admin approves it; then the assignment ends (kept as history). The student keeps their own account and courses."}
        </p>
        {mode === "reassign" && (
          <div>
            <label className="label-field" htmlFor="assign-target">Move to franchise</label>
            <select id="assign-target" value={target} onChange={(e) => setTarget(e.target.value)} className="input-field" required>
              <option value="">Choose an active franchise…</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.franchiseCode} · {p.state}</option>)}
            </select>
            {partners.length === 0 && <p className="mt-1 text-xs text-parchment-muted">There is no other active franchise.</p>}
          </div>
        )}
        <div>
          <label className="label-field" htmlFor="assign-reason">Reason (recorded in the audit history)</label>
          <textarea id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="input-field resize-none" required aria-describedby={error ? "assign-error" : undefined} />
        </div>
        <label className="flex items-start gap-3 text-sm text-parchment">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          <span>I have checked this with the people involved and want to {mode === "reassign" ? "ask for this student to be moved" : "ask for this assignment to end"}.</span>
        </label>
        {error && <p id="assign-error" role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={mode === "end" ? "btn-ghost btn-sm text-danger" : "btn-gold btn-sm"} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "Create request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ReassignRequest {
  id: string;
  kind: "REASSIGN" | "END";
  status: string;
  reason: string;
  payloadSha256: string;
  createdAt: string;
  expiresAt: string;
  requestedBy: { id: string; name: string };
  student: { name: string; email: string } | null;
  from: { franchiseCode: string | null };
  to: { franchiseCode: string | null } | null;
}

/** Pending two-admin reassignment requests: the requester can cancel; any other admin can approve or reject. */
function ReassignRequests({ reloadKey, onDone }: { reloadKey: number; onDone: (msg: string) => void }) {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ReassignRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "approve" | "reject" | "cancel" } | null>(null);

  useEffect(() => {
    api.get<{ requests: ReassignRequest[] }>("/admin/franchise/student-assignment-requests").then(
      (r) => setRequests(r.requests.filter((x) => x.status === "PENDING")),
      (e) => setError(message(e))
    );
  }, [reloadKey]);

  if (requests.length === 0 && !error) return null;
  async function act(r: ReassignRequest, action: "approve" | "reject" | "cancel") {
    setBusy(r.id);
    setError(null);
    try {
      await api.post(`/admin/franchise/student-assignment-requests/${encodeURIComponent(r.id)}/${action}`, action === "approve" ? { expectedPayloadSha: r.payloadSha256 } : {});
      setConfirming(null);
      onDone(action === "approve" ? (r.kind === "END" ? `${r.student?.name ?? "The student"}'s assignment ended.` : `${r.student?.name ?? "The student"} moved to ${r.to?.franchiseCode ?? "the new franchise"}.`) : action === "reject" ? "Request rejected; nothing changed." : "Request cancelled; nothing changed.");
    } catch (err) {
      setError(err instanceof ApiError && err.data.code === "SAME_ADMIN" ? "A different admin must decide this request." : message(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card p-6" aria-labelledby="reassign-requests">
      <h2 id="reassign-requests" className="font-display text-lg font-semibold text-parchment">Assignment requests awaiting a second admin</h2>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {requests.map((r) => {
          const mine = r.requestedBy.id === user?.id;
          const pending = confirming?.id === r.id ? confirming.action : null;
          return (
            <li key={r.id} className="space-y-2 py-3">
              <p className="text-parchment">
                {r.kind === "END" ? (
                  <>End <strong>{r.student?.name ?? "a student"}</strong>&apos;s assignment to {r.from.franchiseCode ?? "?"}</>
                ) : (
                  <>Move <strong>{r.student?.name ?? "a student"}</strong> from {r.from.franchiseCode ?? "?"} to {r.to?.franchiseCode ?? "?"}</>
                )}
              </p>
              <p className="text-xs text-parchment-muted">Reason: {r.reason}</p>
              <p className="text-xs text-parchment-muted">Asked by {r.requestedBy.name} · {formatDateTime(r.createdAt)} · expires {formatDateTime(r.expiresAt)}</p>
              {pending ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm">
                  <span className="text-xs text-parchment">{pending === "approve" ? r.kind === "END" ? "Approve and end the assignment now?" : "Approve and move the student now?" : pending === "reject" ? "Reject this request?" : "Cancel your request?"}</span>
                  <button type="button" className="btn-gold btn-sm" disabled={busy === r.id} onClick={() => act(r, pending)}>{busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "Yes"}</button>
                  <button type="button" className="btn-outline btn-sm" disabled={busy === r.id} onClick={() => setConfirming(null)}>No</button>
                </div>
              ) : mine ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-parchment-muted">Your request — another admin must approve it.</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming({ id: r.id, action: "cancel" })}>Cancel my request</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" className="btn-gold btn-sm" onClick={() => setConfirming({ id: r.id, action: "approve" })}>Approve</button>
                  <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setConfirming({ id: r.id, action: "reject" })}>Reject</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

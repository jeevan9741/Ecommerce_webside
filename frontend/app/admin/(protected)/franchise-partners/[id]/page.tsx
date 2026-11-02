"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";
import { PartnerStatus } from "@/components/franchise/partner-status";

interface Request {
  id: string;
  action: string;
  status: string;
  reason: string;
  payloadSha256: string;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
}
interface Detail {
  id: string;
  franchiseCode: string;
  status: string;
  owner: { id: string; name: string; email: string };
  application: { id: string; applicationNo: string };
  district: { name: string; code: string | null; state: string };
  agreementStartsAt: string;
  agreementEndsAt: string;
  activatedAt: string;
  allocations: { id: string; status: string }[];
  events: { id: string; type: string; fromStatus: string | null; toStatus: string | null; reason: string | null; createdAt: string }[];
  requests: Request[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchDetail = (id: string) => api.get<{ partner: Detail }>(`/admin/franchise/partners/${encodeURIComponent(id)}`).then((r) => r.partner);
const ACTION_LABEL: Record<string, string> = { PARTNER_REINSTATE: "Reinstate", PARTNER_DEACTIVATE: "Deactivate" };

export default function FranchisePartnerAdminPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [p, setP] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"SUSPEND" | "REINSTATE" | "DEACTIVATE" | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => setP(await fetchDetail(id)), [id]);
  useEffect(() => {
    fetchDetail(id).then(setP, (e) => setError(message(e)));
  }, [id]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // Reload first, so the confirmation never sits next to the old status.
      await reload();
      setMode(null);
      setReason("");
      setNotice(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!p) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const pending = p.requests.find((r) => r.status === "PENDING");
  const canSuspend = p.status === "ACTIVE";
  const canReinstate = p.status === "SUSPENDED";
  const canDeactivate = p.status === "ACTIVE" || p.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <Link href="/admin/franchise-partners" className="inline-flex items-center gap-1 text-sm text-parchment-muted hover:text-parchment"><ArrowLeft className="h-4 w-4" /> All partners</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-parchment">{p.franchiseCode}</h1>
        <PartnerStatus status={p.status} />
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Item label="Owner" value={`${p.owner.name} · ${p.owner.email}`} />
            <Item label="Application" value={p.application.applicationNo} />
            <Item label="District" value={`${p.district.name}${p.district.code ? ` (LGD ${p.district.code})` : ""}, ${p.district.state}`} />
            <Item label="District allocation" value={p.allocations.map((a) => a.status).join(", ") || "—"} />
            <Item label="Agreement" value={`${formatDate(p.agreementStartsAt)} – ${formatDate(p.agreementEndsAt)}`} />
            <Item label="Activated" value={formatDateTime(p.activatedAt)} />
          </dl>
          <h2 className="mt-6 font-display text-lg font-semibold text-parchment">History</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {p.events.map((e) => (
              <li key={e.id} className="border-l-2 border-white/10 pl-3">
                <p className="text-parchment">{e.type.replaceAll("_", " ").toLowerCase()}{e.toStatus ? ` → ${e.toStatus}` : ""}</p>
                <p className="text-xs text-parchment-muted">{formatDateTime(e.createdAt)}{e.reason ? ` · ${e.reason}` : ""}</p>
              </li>
            ))}
            {p.events.length === 0 && <li className="text-parchment-muted">No events.</li>}
          </ol>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold text-parchment">Actions</h2>
          {pending ? (
            <div className="space-y-2 rounded-lg border border-white/10 p-3 text-sm">
              <p className="text-parchment">Awaiting approval: <strong>{ACTION_LABEL[pending.action] ?? pending.action}</strong></p>
              <p className="text-xs text-parchment-muted">Asked by {pending.requestedBy.name} · {formatDateTime(pending.createdAt)} · expires {formatDateTime(pending.expiresAt)}</p>
              <p className="text-xs text-parchment-muted">Reason: {pending.reason}</p>
              <p className="text-xs text-parchment-muted [overflow-wrap:anywhere]">Request hash: {pending.payloadSha256}</p>
              {pending.requestedBy.id === user?.id ? (
                <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/admin/franchise/partner-requests/${pending.id}/cancel`, {}), "Request cancelled.")}>Cancel my request</button>
              ) : (
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className="btn-gold btn-sm" onClick={() => run(() => api.post(`/admin/franchise/partner-requests/${pending.id}/approve`, { expectedPayloadSha: pending.payloadSha256 }), "Approved and applied.")}>Approve</button>
                  <button type="button" disabled={busy} className="btn-ghost btn-sm text-danger" onClick={() => run(() => api.post(`/admin/franchise/partner-requests/${pending.id}/reject`, {}), "Request rejected.")}>Reject</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canSuspend && <button type="button" className="btn-outline btn-sm text-danger" onClick={() => setMode("SUSPEND")}>Suspend now</button>}
              {canReinstate && <button type="button" className="btn-outline btn-sm" onClick={() => setMode("REINSTATE")}>Request reinstatement</button>}
              {canDeactivate && <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => setMode("DEACTIVATE")}>Request deactivation</button>}
              {!canSuspend && !canReinstate && !canDeactivate && <p className="text-sm text-parchment-muted">No actions for a {p.status.toLowerCase()} franchise.</p>}
            </div>
          )}
          {mode && (
            <div className="space-y-2 rounded-lg border border-white/10 p-3" role="dialog" aria-label={mode}>
              <p className="text-sm text-parchment">
                {mode === "SUSPEND" ? "Suspend this franchise now? Its owner loses dashboard access immediately; the district stays held." : mode === "REINSTATE" ? "Ask a second admin to reinstate this franchise?" : "Ask a second admin to deactivate this franchise? The district stays held until it's released separately."}
              </p>
              <label htmlFor="reason" className="label-field">Reason (at least 10 characters)</label>
              <textarea id="reason" rows={3} maxLength={1000} className="input-field resize-none text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 10}
                  className="btn-gold btn-sm"
                  onClick={() =>
                    run(
                      () => (mode === "SUSPEND" ? api.post(`/admin/franchise/partners/${p.id}/suspend`, { reason: reason.trim() }) : api.post(`/admin/franchise/partners/${p.id}/requests`, { action: mode, reason: reason.trim() })),
                      mode === "SUSPEND" ? "Franchise suspended." : "Request sent for a second admin's approval."
                    )
                  }
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                </button>
                <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-parchment-muted">{label}</dt>
      <dd className="mt-1 text-parchment">{value}</dd>
    </div>
  );
}

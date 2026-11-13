"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";

interface AdminRow {
  id: string;
  name: string;
  email: string;
  mfaEnabledAt: string | null;
}
interface ResetRequest {
  id: string;
  status: string;
  reason: string;
  payloadSha256: string;
  createdAt: string;
  expiresAt: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  target: { id: string; name: string; email: string } | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchAll = () =>
  Promise.all([
    api.get<{ admins: AdminRow[] }>("/admin/security/admins").then((r) => r.admins),
    api.get<{ requests: ResetRequest[] }>("/admin/security/mfa-reset-requests").then((r) => r.requests),
  ]);

/**
 * Admin Security: which admins have two-step verification, and the two-admin reset for an admin who lost
 * both their authenticator and their recovery codes. One admin asks (with a reason); a different admin —
 * never the one being reset — approves. The reset admin then sets two-step verification up again.
 */
export default function AdminSecurityPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<AdminRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<{ id: string; action: "approve" | "reject" | "cancel" } | null>(null);

  const apply = useCallback(([a, r]: [AdminRow[], ResetRequest[]]) => {
    setAdmins(a);
    setRequests(r);
  }, []);
  const reload = useCallback(() => fetchAll().then(apply, (e) => setError(message(e))), [apply]);
  useEffect(() => {
    fetchAll().then(apply, (e) => setError(message(e)));
  }, [apply]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!asking) return;
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters (how you confirmed who is asking).");
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/security/admins/${encodeURIComponent(asking.id)}/mfa-reset-requests`, { reason: reason.trim() });
      setNotice(`Reset request for ${asking.name} created. A different admin must approve it.`);
      setAsking(null);
      setReason("");
      await reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(r: ResetRequest, action: "approve" | "reject" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/security/mfa-reset-requests/${encodeURIComponent(r.id)}/${action}`, action === "approve" ? { expectedPayloadSha: r.payloadSha256 } : {});
      setNotice(action === "approve" ? `${r.target?.name ?? "The admin"}'s two-step verification was reset. They must set it up again at their next sign-in.` : action === "reject" ? "Request rejected." : "Request cancelled.");
      setConfirming(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && (err.data.code === "SAME_ADMIN" || err.data.code === "SELF_RESET") ? "A different admin — not the one being reset — must approve this request." : message(err));
    } finally {
      setBusy(false);
    }
  }

  if (!admins) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Admin Security</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Every admin signs in with a password and an authenticator code. Your own setup and recovery codes are on the <Link href="/admin/mfa" className="text-gold-400 underline">two-step verification page</Link>.
        </p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      {pending.length > 0 && (
        <section className="card p-6" aria-labelledby="pending-resets">
          <h2 id="pending-resets" className="font-display text-lg font-semibold text-parchment">Reset requests awaiting a second admin</h2>
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {pending.map((r) => {
              const mine = r.requestedBy.id === user?.id;
              const self = r.target?.id === user?.id;
              const c = confirming?.id === r.id ? confirming.action : null;
              return (
                <li key={r.id} className="space-y-2 py-3">
                  <p className="text-parchment">Reset two-step verification for <strong>{r.target?.name ?? "an admin"}</strong> ({r.target?.email})</p>
                  <p className="text-xs text-parchment-muted">Reason: {r.reason}</p>
                  <p className="text-xs text-parchment-muted">Asked by {r.requestedBy.name} · {formatDateTime(r.createdAt)} · expires {formatDateTime(r.expiresAt)}</p>
                  {c ? (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm">
                      <span className="text-xs text-parchment">{c === "approve" ? "Approve and reset now?" : c === "reject" ? "Reject this request?" : "Cancel your request?"}</span>
                      <button type="button" className="btn-gold btn-sm" disabled={busy} onClick={() => act(r, c)}>Yes</button>
                      <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => setConfirming(null)}>No</button>
                    </div>
                  ) : mine ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming({ id: r.id, action: "cancel" })}>Cancel my request</button>
                  ) : self ? (
                    <p className="text-xs text-parchment-muted">This request is about your account; another admin must decide it.</p>
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
      )}

      <section className="card overflow-x-auto" aria-labelledby="admins-title">
        <h2 id="admins-title" className="p-4 font-display text-lg font-semibold text-parchment">Admins</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Admin</th>
              <th className="px-4 py-2 font-medium">Two-step verification</th>
              <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-t border-white/5">
                <td className="px-4 py-3"><p className="text-parchment">{a.name}</p><p className="text-xs text-parchment-muted">{a.email}</p></td>
                <td className="px-4 py-3 text-xs">{a.mfaEnabledAt ? <span className="text-emerald">On since {formatDateTime(a.mfaEnabledAt)}</span> : <span className="text-danger">Not set up</span>}</td>
                <td className="px-4 py-3 text-right">
                  {a.mfaEnabledAt && a.id !== user?.id && !pending.some((r) => r.target?.id === a.id) && (
                    <button type="button" className="btn-outline btn-sm" onClick={() => { setAsking(a); setReason(""); setError(null); }}>Request reset</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {asking && (
        <form onSubmit={ask} className="card space-y-3 p-6" aria-label={`Request a reset for ${asking.name}`}>
          <p className="text-sm text-parchment">
            Request a reset of <strong>{asking.name}</strong>&apos;s two-step verification. Use this only when they have lost both their authenticator and their recovery codes and you
            have confirmed who they are. A different admin must approve it.
          </p>
          <label className="label-field" htmlFor="reset-reason">Reason (how you confirmed their identity)</label>
          <textarea id="reset-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="input-field resize-none" />
          <div className="flex gap-2">
            <button type="submit" className="btn-gold btn-sm" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "Create request"}</button>
            <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

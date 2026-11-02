"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { INVITE_STATUS_LABEL, canCancel, inviteFormError, resendState, type InviteRow } from "@/lib/franchise-invite";

interface StudentRow {
  id: string;
  name: string;
  linkedAt: string;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchInvites = () => api.get<{ invites: InviteRow[] }>("/franchise-partner/invites").then((r) => r.invites);
const fetchStudents = (q: string) => api.get<{ students: StudentRow[]; total: number }>(`/franchise-partner/students${q ? `?q=${encodeURIComponent(q)}` : ""}`);

/** The franchise's own students and invitations (the server scopes everything to this franchise). */
export default function FranchiseStudentsPage() {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [students, setStudents] = useState<{ students: StudentRow[]; total: number } | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", email: "", mobile: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadInvites = useCallback(async () => setInvites(await fetchInvites()), []);
  useEffect(() => {
    fetchInvites().then(setInvites, (e) => setError(message(e)));
    fetchStudents("").then(setStudents, (e) => setError(message(e)));
  }, []);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reloadInvites();
      setNotice(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const problem = inviteFormError(form);
    if (problem) return setError(problem);
    await act(async () => {
      const r = await api.post<{ emailed: boolean }>("/franchise-partner/invites", { name: form.name.trim(), email: form.email.trim(), ...(form.mobile.trim() ? { mobile: form.mobile.trim() } : {}) });
      setForm({ name: "", email: "", mobile: "" });
      if (!r.emailed) throw new Error("The invitation was saved, but the email couldn't be sent. Try resending it later.");
    }, "Invitation sent. The student accepts it from their own ETA account.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Students</h1>
        <p className="mt-1 text-sm text-parchment-muted">Invite students by email. They join your franchise by accepting the invitation from their own account — you never create accounts or passwords for them.</p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <form onSubmit={sendInvite} className="card grid gap-3 p-5 sm:grid-cols-4" noValidate>
        <div>
          <label htmlFor="inv-name" className="label-field">Student name</label>
          <input id="inv-name" className="input-field text-sm" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="inv-email" className="label-field">Email</label>
          <input id="inv-email" type="email" className="input-field text-sm" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label htmlFor="inv-mobile" className="label-field">Mobile (optional)</label>
          <input id="inv-mobile" inputMode="numeric" maxLength={10} className="input-field text-sm" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={busy} className="btn-gold btn-sm inline-flex w-full items-center justify-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send invitation
          </button>
        </div>
      </form>

      <section className="card overflow-x-auto">
        <h2 className="px-5 pt-5 font-display text-lg font-semibold text-parchment">Invitations</h2>
        <table className="mt-3 w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-5 py-2 font-medium">Student</th>
              <th className="px-5 py-2 font-medium">Status</th>
              <th className="px-5 py-2 font-medium">Expires</th>
              <th className="px-5 py-2 font-medium">Sent</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {invites?.map((i) => {
              const rs = resendState(i);
              return (
                <tr key={i.id} className="border-t border-white/5">
                  <td className="px-5 py-2.5"><p className="text-parchment">{i.inviteeName}</p><p className="text-xs text-parchment-muted">{i.email}</p></td>
                  <td className="px-5 py-2.5 text-parchment">{INVITE_STATUS_LABEL[i.status] ?? i.status}</td>
                  <td className="px-5 py-2.5 text-parchment-muted">{i.status === "OPEN" || i.status === "EXPIRED" ? formatDateTime(i.expiresAt) : "—"}</td>
                  <td className="px-5 py-2.5 text-parchment-muted">{i.sendCount} of 5</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      {rs.reason && <span className="text-xs text-parchment-muted">{rs.reason}</span>}
                      {(i.status === "OPEN" || i.status === "EXPIRED") && (
                        <button type="button" disabled={busy || !rs.ok} className="btn-ghost btn-sm" onClick={() => act(() => api.post(`/franchise-partner/invites/${i.id}/resend`), "Invitation resent with a new link; the previous link no longer works.")}>Resend</button>
                      )}
                      {canCancel(i) && <button type="button" disabled={busy} className="btn-ghost btn-sm text-danger" onClick={() => act(() => api.post(`/franchise-partner/invites/${i.id}/cancel`), "Invitation cancelled.")}>Cancel</button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!invites && <p className="flex items-center gap-2 p-5 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {invites?.length === 0 && <p className="p-5 text-sm text-parchment-muted">No invitations yet.</p>}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 className="font-display text-lg font-semibold text-parchment">Your students {students ? `(${students.total})` : ""}</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              fetchStudents(q.trim()).then(setStudents, (err) => setError(message(err)));
            }}
          >
            <input aria-label="Search students" className="input-field !w-56 text-sm" placeholder="Search by name" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn-outline btn-sm" aria-label="Search"><Search className="h-4 w-4" /></button>
          </form>
        </div>
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {students?.students.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-3">
              <Link href={`/franchise-partner/students/${s.id}`} className="font-medium text-parchment hover:underline">{s.name}</Link>
              <span className="text-xs text-parchment-muted">Joined {formatDate(s.linkedAt)}</span>
            </li>
          ))}
        </ul>
        {students?.students.length === 0 && <p className="p-5 text-sm text-parchment-muted">No students yet. They appear here once they accept your invitation.</p>}
      </section>
    </div>
  );
}

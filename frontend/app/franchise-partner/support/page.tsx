"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { AWAITING_LABEL, CATEGORY_LABEL, TICKET_CATEGORIES, TICKET_STATUS_LABEL, newTicketError, type TicketRow } from "@/lib/franchise-tickets";

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchTickets = () => api.get<{ tickets: TicketRow[] }>("/franchise-partner/tickets").then((r) => r.tickets);

/** The franchise's own support tickets (the server returns only this franchise's). */
export default function FranchiseSupportPage() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [form, setForm] = useState({ subject: "", category: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    fetchTickets().then(setTickets, (e) => setError(message(e)));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const problem = newTicketError(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ ticket: { ticketNo: string } }>("/franchise-partner/tickets", { subject: form.subject.trim(), category: form.category, message: form.message.trim() });
      setForm({ subject: "", category: "", message: "" });
      setTickets(await fetchTickets());
      setNotice(`Ticket ${r.ticket.ticketNo} created. ETA will reply here and by email.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Support</h1>
        <p className="mt-1 text-sm text-parchment-muted">Raise a question with ETA. Only your franchise and ETA&apos;s team can see your tickets.</p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <form onSubmit={create} className="card grid gap-3 p-5 sm:grid-cols-3" noValidate>
        <div className="sm:col-span-2">
          <label htmlFor="t-subject" className="label-field">Subject</label>
          <input id="t-subject" className="input-field text-sm" maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </div>
        <div>
          <label htmlFor="t-category" className="label-field">Category</label>
          <select id="t-category" className="input-field text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Choose…</option>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="t-message" className="label-field">What&apos;s happening?</label>
          <textarea id="t-message" rows={4} maxLength={5000} className="input-field resize-none text-sm" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <button type="submit" disabled={busy} className="btn-gold btn-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create ticket"}</button>
        </div>
      </form>

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-parchment-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Ticket</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {tickets?.map((t) => (
              <tr key={t.id} className="border-t border-white/5">
                <td className="px-5 py-3">
                  <Link href={`/franchise-partner/support/${t.id}`} className="font-medium text-parchment hover:underline">{t.ticketNo}</Link>
                  <p className="text-xs text-parchment-muted">{t.subject}</p>
                </td>
                <td className="px-5 py-3 text-parchment-muted">{CATEGORY_LABEL[t.category] ?? t.category}</td>
                <td className="px-5 py-3 text-parchment">{TICKET_STATUS_LABEL[t.status] ?? t.status}<p className="text-xs text-parchment-muted">{AWAITING_LABEL[t.awaiting]}</p></td>
                <td className="px-5 py-3 text-parchment-muted">{formatDateTime(t.lastMessageAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tickets && !error && <p className="flex items-center gap-2 p-5 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
        {tickets?.length === 0 && <p className="p-5 text-sm text-parchment-muted">No tickets yet.</p>}
      </section>
    </div>
  );
}

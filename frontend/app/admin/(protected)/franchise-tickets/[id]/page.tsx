"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AWAITING_LABEL, CATEGORY_LABEL, TICKET_STATUS_LABEL, adminStatusTargets } from "@/lib/franchise-tickets";
import { TicketConversation, type ConversationEvent, type ConversationMessage } from "@/components/franchise/ticket-conversation";

interface Ticket {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  status: string;
  awaiting: string;
  version: number;
  partner: { franchiseCode: string; status: string; ownerName: string; district: string };
  messages: ConversationMessage[];
  events: ConversationEvent[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchTicket = (id: string) => api.get<{ ticket: Ticket }>(`/admin/franchise/tickets/${encodeURIComponent(id)}`).then((r) => r.ticket);

export default function FranchiseTicketAdminPage() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Ticket | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = useCallback(async () => setT(await fetchTicket(id)), [id]);
  useEffect(() => {
    fetchTicket(id).then(setT, (e) => setError(message(e)));
  }, [id]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      setNotice(done);
    } catch (e) {
      setError(e instanceof ApiError && e.data.code === "STALE" ? "This ticket changed — it has been reloaded; try again." : message(e));
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (!t) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const targets = adminStatusTargets(t.status);

  return (
    <div className="space-y-6">
      <Link href="/admin/franchise-tickets" className="inline-flex items-center gap-1 text-sm text-parchment-muted hover:text-parchment"><ArrowLeft className="h-4 w-4" /> All tickets</Link>
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">{t.ticketNo}: {t.subject}</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          {t.partner.franchiseCode} · {t.partner.ownerName} · {t.partner.district} · {CATEGORY_LABEL[t.category]} · {TICKET_STATUS_LABEL[t.status]} · {AWAITING_LABEL[t.awaiting]}
        </p>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <TicketConversation messages={t.messages} events={t.events} viewer="ADMIN" />
        </section>
        <div className="space-y-6">
          {t.status !== "CLOSED" ? (
            <section className="card space-y-3 p-5">
              <label htmlFor="reply" className="label-field">{internal ? "Internal note (admins only)" : "Reply to the franchise"}</label>
              <textarea id="reply" rows={5} maxLength={5000} className="input-field resize-none text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
              <label className="flex items-center gap-2 text-xs text-parchment-muted">
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (not shown to the franchise, no email)
              </label>
              <button
                type="button"
                disabled={busy || !body.trim()}
                className="btn-gold btn-sm"
                onClick={() => run(async () => { await api.post(`/admin/franchise/tickets/${t.id}/messages`, { body: body.trim(), internal }); setBody(""); }, internal ? "Internal note added." : "Reply sent; the franchise has been emailed.")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : internal ? "Add note" : "Send reply"}
              </button>
            </section>
          ) : (
            <p className="text-sm text-parchment-muted">This ticket is closed (final).</p>
          )}
          {targets.length > 0 && (
            <section className="card space-y-2 p-5">
              <h2 className="text-sm font-semibold text-parchment">Change status</h2>
              <div className="flex flex-wrap gap-2">
                {targets.map((s) => (
                  <button key={s} type="button" disabled={busy} className={s === "CLOSED" ? "btn-ghost btn-sm text-danger" : "btn-outline btn-sm"} onClick={() => run(() => api.post(`/admin/franchise/tickets/${t.id}/status`, { to: s, expectedVersion: t.version }), `Status changed to ${TICKET_STATUS_LABEL[s]}.`)}>
                    {TICKET_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-parchment-muted">Resolving or closing emails the franchise. Closed is final.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

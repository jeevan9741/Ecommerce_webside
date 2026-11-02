"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, TICKET_STATUS_LABEL, partnerCanReply } from "@/lib/franchise-tickets";
import { TicketConversation, type ConversationEvent, type ConversationMessage } from "@/components/franchise/ticket-conversation";

interface Ticket {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  status: string;
  version: number;
  messages: ConversationMessage[];
  events: ConversationEvent[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchTicket = (id: string) => api.get<{ ticket: Ticket }>(`/franchise-partner/tickets/${encodeURIComponent(id)}`).then((r) => r.ticket);

export default function FranchiseTicketPage() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => setT(await fetchTicket(id)), [id]);
  useEffect(() => {
    fetchTicket(id).then(setT, (e) => setError(message(e)));
  }, [id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/franchise-partner/support" className="inline-flex items-center gap-1 text-sm text-parchment-muted hover:text-parchment"><ArrowLeft className="h-4 w-4" /> All tickets</Link>
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}
      {!t && !error && <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {t && (
        <>
          <div>
            <h1 className="font-display text-2xl font-semibold text-parchment">{t.ticketNo}: {t.subject}</h1>
            <p className="mt-1 text-sm text-parchment-muted">{CATEGORY_LABEL[t.category]} · {TICKET_STATUS_LABEL[t.status]}</p>
          </div>
          <section className="card p-5">
            <TicketConversation messages={t.messages} events={t.events} viewer="PARTNER" />
          </section>
          {partnerCanReply(t.status) ? (
            <section className="card space-y-3 p-5">
              <label htmlFor="reply" className="label-field">Reply{t.status === "RESOLVED" ? " (this re-opens the ticket)" : ""}</label>
              <textarea id="reply" rows={4} maxLength={5000} className="input-field resize-none text-sm" value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !reply.trim()} className="btn-gold btn-sm" onClick={() => run(async () => { await api.post(`/franchise-partner/tickets/${t.id}/messages`, { body: reply.trim() }); setReply(""); })}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reply"}
                </button>
                <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/franchise-partner/tickets/${t.id}/close`, { expectedVersion: t.version }))}>Close ticket</button>
              </div>
            </section>
          ) : (
            <p className="text-sm text-parchment-muted">This ticket is closed. Create a new ticket if you need more help.</p>
          )}
        </>
      )}
    </div>
  );
}

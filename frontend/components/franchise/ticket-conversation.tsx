import { formatDateTime } from "@/lib/format";
import { TICKET_STATUS_LABEL } from "@/lib/franchise-tickets";

export interface ConversationMessage {
  id: string;
  authorRole: string;
  authorName?: string;
  body: string;
  internal?: boolean;
  createdAt: string;
}
export interface ConversationEvent {
  id: string;
  actorRole: string;
  actorName?: string;
  fromStatus: string | null;
  toStatus: string;
  note?: string | null;
  createdAt: string;
}

/** Messages and status changes in one timeline. Nothing here can be edited or deleted. */
export function TicketConversation({ messages, events, viewer }: { messages: ConversationMessage[]; events: ConversationEvent[]; viewer: "PARTNER" | "ADMIN" }) {
  const items = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.createdAt, m })),
    ...events.map((e) => ({ kind: "event" as const, at: e.createdAt, e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <ol className="space-y-3">
      {items.map((it) =>
        it.kind === "message" ? (
          <li
            key={it.m.id}
            className={`rounded-lg border p-4 text-sm ${it.m.internal ? "border-gold-500/40 bg-gold-500/5" : it.m.authorRole === viewer ? "border-border-strong bg-ink-elevated" : "border-emerald/30 bg-emerald/5"}`}
          >
            <p className="text-xs text-parchment-muted">
              {it.m.internal ? "Internal note · " : ""}
              {it.m.authorRole === "ADMIN" ? (viewer === "ADMIN" ? (it.m.authorName ?? "ETA") : "ETA support") : viewer === "PARTNER" ? "You" : (it.m.authorName ?? "Franchise")}
              {" · "}
              {formatDateTime(it.m.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-line text-parchment">{it.m.body}</p>
          </li>
        ) : (
          <li key={it.e.id} className="text-center text-xs text-parchment-muted">
            {it.e.fromStatus ? `${TICKET_STATUS_LABEL[it.e.fromStatus]} → ` : ""}
            {TICKET_STATUS_LABEL[it.e.toStatus]} · {it.e.actorRole === "ADMIN" ? (viewer === "ADMIN" ? (it.e.actorName ?? "ETA") : "ETA") : viewer === "PARTNER" ? "you" : (it.e.actorName ?? "franchise")} · {formatDateTime(it.e.createdAt)}
            {viewer === "ADMIN" && it.e.note ? ` · ${it.e.note}` : ""}
          </li>
        )
      )}
    </ol>
  );
}

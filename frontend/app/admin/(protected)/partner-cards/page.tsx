"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { BadgeCheck, Camera, Check, HandCoins, Loader2, Plus, Power, RefreshCw, Save, Search, Settings, X } from "lucide-react";
import { formatDate, formatInr } from "@/lib/format";
import {
  PAYMENT_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  STATUS_LABEL,
  toCardArt,
  watermarkFor,
  type PartnerCard,
  type PartnerCardRequest,
  type PartnerCardRequestSummary,
  type PartnerCardStatus,
} from "@/lib/partner-card/types";
import {
  partnerCardService,
  type AdminCardDetail,
  type ListFilter,
  type PartnerCardEdit,
  type PartnerCardSummary,
} from "@/services/partnerCardService";
import { Modal } from "@/components/admin/modal";
import { ToastStack, useToasts } from "@/components/toast";
import { PartnerCardPreview } from "@/components/partner-card/card-preview";
import { PartnerCardExports } from "@/components/partner-card/card-exports";
import { errorMessage, readCardPhoto } from "@/components/partner-card/partner-card-manager";

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "PENDING", label: "New requests" },
  { value: "REISSUE", label: "Reissue requests" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "REJECTED", label: "Rejected" },
];

const STATUS_CHIP: Record<PartnerCardStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-slate-200 bg-slate-100 text-slate-600",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
};

const chip = "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider";

function StatusChip({ status }: { status: PartnerCardStatus }) {
  return <span className={`${chip} ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>;
}

function RequestChip({ request }: { request: Pick<PartnerCardRequest, "kind" | "status" | "paymentStatus" | "feeInPaise"> }) {
  if (request.kind === "FREE") return null;
  const unpaid = request.status === "AWAITING_PAYMENT";
  return (
    <span className={`${chip} ${unpaid ? "border-orange-200 bg-orange-50 text-orange-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
      Reissue · {unpaid ? `awaiting ${formatInr(request.feeInPaise)}` : PAYMENT_STATUS_LABEL[request.paymentStatus]}
    </span>
  );
}

export default function AdminPartnerCardsPage() {
  const [status, setStatus] = useState<ListFilter>("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cards, setCards] = useState<PartnerCardSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<PartnerCardStatus | "REISSUE", number> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    try {
      const data = await partnerCardService.list({ status, q: search });
      setCards(data.cards);
      setCounts(data.counts);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load partner cards."));
    }
  }, [status, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    load();
  }, [load]);

  const total = counts ? counts.PENDING + counts.ACTIVE + counts.INACTIVE + counts.REJECTED : 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Partner ID Cards</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            Each partner gets one free card; further cards are paid reissues that you approve here. Every card verifies
            publicly at /verify/&lt;Partner ID&gt;.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/partner-card-settings" className="btn-outline btn-sm">
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <button type="button" onClick={() => setIssuing(true)} className="btn-gold btn-sm">
            <Plus className="h-4 w-4" /> Issue card
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                status === f.value
                  ? "border-gold-500 bg-gold-500 text-white"
                  : "border-border-soft bg-surface text-parchment-muted hover:border-gold-500/50"
              }`}
            >
              {f.label}
              {counts && <span className="ml-1.5 opacity-80">{f.value ? counts[f.value] : total}</span>}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, Partner ID, email or phone"
            className="input-field !py-2 lg:w-72"
          />
          <button type="submit" className="btn-outline btn-sm" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>

      <div className="mt-5 space-y-3">
        {loadError && <p className="card p-5 text-sm text-danger">{loadError}</p>}
        {!cards && !loadError && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        )}
        {cards?.map((c) => (
          <div key={c.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-parchment">{c.fullName}</p>
                <span className="font-mono text-xs font-semibold text-gold-500">{c.partnerId}</span>
                <StatusChip status={c.status} />
                {c.openRequest && <RequestChip request={c.openRequest} />}
              </div>
              <p className="mt-1 truncate text-xs text-parchment-muted">
                {c.email} · {c.phone} · {c.location}
              </p>
              <p className="mt-0.5 text-xs text-parchment-muted">
                Issue count {c.issueCount}
                {c.firstIssuedAt ? ` · first issued ${formatDate(c.firstIssuedAt)}` : ` · requested ${formatDate(c.createdAt)}`}
                {c.issueCount > 1 && c.issuedAt && ` · latest ${formatDate(c.issuedAt)}`}
              </p>
            </div>
            <button type="button" onClick={() => setOpenId(c.id)} className="btn-outline btn-sm shrink-0">
              {c.openRequest?.status === "PENDING" ? "Review" : "Manage"}
            </button>
          </div>
        ))}
        {cards?.length === 0 && (
          <p className="card p-8 text-center text-sm text-parchment-muted">No partner cards match this view.</p>
        )}
      </div>

      {openId && <CardEditor id={openId} onClose={() => setOpenId(null)} onChanged={load} push={push} />}
      {issuing && (
        <IssueDialog
          onClose={() => setIssuing(false)}
          onIssued={(card) => {
            setIssuing(false);
            load();
            setOpenId(card.id);
            push("success", `Card ${card.partnerId} issued and active.`);
          }}
          onError={(m) => push("error", m)}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- issue ----------

function IssueDialog({
  onClose,
  onIssued,
  onError,
}: {
  onClose: () => void;
  onIssued: (card: PartnerCard) => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { card } = await partnerCardService.issue({ email: email.trim(), location: location.trim(), validFrom });
      onIssued(card);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Issue a Partner ID card" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-parchment-muted">
          Issues the partner&apos;s free card straight away for an existing account, using its name, email and phone.
          Add the photo afterwards.
        </p>
        <label className="block">
          <span className="label-field">Account email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
        </label>
        <label className="block">
          <span className="label-field">Location (City, State)</span>
          <input required maxLength={48} value={location} onChange={(e) => setLocation(e.target.value)} className="input-field" />
        </label>
        <label className="block">
          <span className="label-field">Valid from</span>
          <input type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="input-field" />
        </label>
        <button type="submit" disabled={busy} className="btn-gold btn-block">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Issue card
        </button>
      </form>
    </Modal>
  );
}

// ---------- editor ----------

interface Draft {
  fullName: string;
  role: string;
  location: string;
  email: string;
  phone: string;
  validFrom: string;
  photo: string | null;
  signature: string | null;
  adminNote: string;
  /** Rupees as typed; blank = use the settings fee. */
  reissueFee: string;
}

function toDraft(card: PartnerCard): Draft {
  return {
    fullName: card.fullName,
    role: card.role,
    location: card.location,
    email: card.email,
    phone: card.phone,
    validFrom: card.validFrom ? card.validFrom.slice(0, 10) : "",
    photo: card.photo,
    signature: card.signature,
    adminNote: card.adminNote ?? "",
    reissueFee: card.reissueFeeInPaise === null ? "" : String(card.reissueFeeInPaise / 100),
  };
}

/** Only the fields that differ from the saved card, in the shape the API expects. */
function changes(card: PartnerCard, draft: Draft): PartnerCardEdit {
  const saved = toDraft(card);
  const out: PartnerCardEdit = {};
  for (const key of ["fullName", "role", "location", "email", "phone"] as const) {
    if (draft[key].trim() !== saved[key]) out[key] = draft[key].trim();
  }
  if (draft.validFrom !== saved.validFrom) out.validFrom = draft.validFrom || null;
  if (draft.photo !== saved.photo && draft.photo) out.photo = draft.photo;
  if (draft.signature !== saved.signature) out.signature = draft.signature;
  if (draft.adminNote.trim() !== saved.adminNote) out.adminNote = draft.adminNote.trim() || null;
  if (draft.reissueFee.trim() !== saved.reissueFee) {
    out.reissueFeeInPaise = draft.reissueFee.trim() === "" ? null : Math.round(Number(draft.reissueFee) * 100);
  }
  return out;
}

/**
 * Turns an uploaded signature (dark ink on a light background) into white ink on transparency,
 * since it prints on the card's blue contact band.
 */
async function readSignature(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image of the signature.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width, 240 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const ink = Math.max(0, Math.min(255, (235 - lum) * 1.6)) * (px[i + 3] / 255);
    px[i] = px[i + 1] = px[i + 2] = 255;
    px[i + 3] = ink;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function CardEditor({
  id,
  onClose,
  onChanged,
  push,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  push: (type: "success" | "error", message: string) => void;
}) {
  const [detail, setDetail] = useState<AdminCardDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [showRequested, setShowRequested] = useState(true);
  const photoRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const next = await partnerCardService.get(id);
    setDetail(next);
    setDraft(toDraft(next.card));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open
    reload().catch((err) => {
      push("error", errorMessage(err, "Could not load this card."));
      onClose();
    });
  }, [reload, onClose, push]);

  const card = detail?.card ?? null;
  const request = detail?.openRequest ?? null;
  const pendingReissue = request?.kind === "REISSUE" ? request : null;
  const previewRequested = Boolean(pendingReissue && showRequested);

  const art = useMemo(() => {
    if (!card || !draft) return null;
    const base = {
      ...toCardArt(card),
      fullName: draft.fullName,
      role: draft.role,
      location: draft.location,
      email: draft.email,
      phone: draft.phone,
      validFrom: draft.validFrom ? `${draft.validFrom}T00:00:00.000Z` : null,
      photo: draft.photo,
      signature: draft.signature,
    };
    // Show what the reissue would print: the partner's requested details over the current card.
    return previewRequested && pendingReissue
      ? { ...base, fullName: pendingReissue.fullName, location: pendingReissue.location, phone: pendingReissue.phone, photo: pendingReissue.photo ?? base.photo }
      : base;
  }, [card, draft, previewRequested, pendingReissue]);

  if (!detail || !card || !draft || !art) {
    return (
      <Modal title="Partner ID card" onClose={onClose} size="xl">
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      </Modal>
    );
  }

  const pending = changes(card, draft);
  const dirty = Object.keys(pending).length > 0;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function act(label: string, fn: () => Promise<unknown>, success: string) {
    setBusy(label);
    setConfirm(null);
    try {
      await fn();
      await reload();
      onChanged();
      push("success", success);
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** Destructive actions need a second click within a few seconds. */
  function confirmThen(label: string, run: () => void) {
    if (confirm === label) return run();
    setConfirm(label);
    setTimeout(() => setConfirm((c) => (c === label ? null : c)), 5000);
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      set({ photo: await readCardPhoto(file) });
    } catch (err) {
      push("error", errorMessage(err, "We couldn't read that image."));
    }
  }

  async function onSignature(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      set({ signature: await readSignature(file) });
    } catch (err) {
      push("error", errorMessage(err, "We couldn't read that image."));
    }
  }

  const note = draft.adminNote.trim() || undefined;
  const review = (action: "APPROVE" | "REJECT") =>
    partnerCardService.review(card.id, { action, adminNote: note, validFrom: action === "APPROVE" ? draft.validFrom || undefined : undefined });

  return (
    <Modal title={`${card.fullName} · ${card.partnerId}`} onClose={onClose} size="xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={card.status} />
            {request && <RequestChip request={request} />}
            {dirty && <span className="text-xs font-semibold text-amber-600">Unsaved changes shown in preview</span>}
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Issue count" value={String(card.issueCount)} />
            <Stat label="First issued" value={card.firstIssuedAt ? formatDate(card.firstIssuedAt) : "Not yet"} />
            <Stat label="Latest issue" value={card.issuedAt ? formatDate(card.issuedAt) : "—"} />
            <Stat
              label="Next card"
              value={detail.quote.free ? "Free" : detail.quote.paymentRequired ? formatInr(detail.quote.feeInPaise) : "No charge"}
            />
          </dl>

          {pendingReissue && (
            <label className="flex items-center gap-2 text-xs font-semibold text-parchment-muted">
              <input type="checkbox" checked={showRequested} onChange={(e) => setShowRequested(e.target.checked)} />
              Preview the requested reissue (unchecked shows the current card)
            </label>
          )}
          <PartnerCardPreview art={art} watermark={previewRequested ? "REISSUE PREVIEW" : watermarkFor(card.status)} />
          <div className="border-t border-border-soft pt-4">
            <p className="label-field">Export (saved version)</p>
            <PartnerCardExports partnerId={card.partnerId} onError={(m) => push("error", m)} />
          </div>
          <HistoryTable history={detail.history} />
        </div>

        <div className="space-y-5">
          {/* open request */}
          <div className="rounded-2xl border border-border-soft p-4">
            <p className="label-field">{request ? (request.kind === "FREE" ? "First card request" : "Reissue request") : "Card status"}</p>

            {request && (
              <div className="mb-3 space-y-1 text-xs text-parchment-muted">
                <p>
                  {REQUEST_STATUS_LABEL[request.status]} · submitted {formatDate(request.createdAt)}
                </p>
                <p>
                  Payment: <span className="font-semibold text-parchment">{PAYMENT_STATUS_LABEL[request.paymentStatus]}</span>
                  {request.feeInPaise > 0 && ` · ${formatInr(request.feeInPaise)}`}
                  {request.razorpayPaymentId && ` · ${request.razorpayPaymentId}`}
                </p>
                {request.reason && <p>Reason: {request.reason}</p>}
                {request.kind === "REISSUE" && (
                  <p>
                    Requested: {request.fullName} · {request.location} · {request.phone}
                    {request.photo ? " · new photo" : ""}
                  </p>
                )}
              </div>
            )}

            {request && (
              <div className="space-y-2">
                {(request.kind === "FREE" || request.status === "PENDING") && (
                  <label className="block">
                    <span className="text-xs text-parchment-muted">Valid from{request.kind === "FREE" ? " (defaults to today)" : " (blank keeps current)"}</span>
                    <input type="date" value={draft.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className="input-field !py-2" />
                  </label>
                )}
                <div className="flex gap-2">
                  {request.status === "AWAITING_PAYMENT" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        confirmThen("waive", () => act("waive", () => partnerCardService.waiveFee(card.id), "Fee waived — the request is ready for approval."))
                      }
                      className="btn-outline btn-sm flex-1"
                    >
                      {busy === "waive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
                      {confirm === "waive" ? "Confirm waive" : "Waive / paid offline"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null || dirty}
                      onClick={() =>
                        act("approve", () => review("APPROVE"), request.kind === "FREE" ? "Card approved and issued." : "Reissue approved — new card issued.")
                      }
                      className="btn-gold btn-sm flex-1"
                    >
                      {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {request.kind === "FREE" ? "Approve & issue" : "Approve reissue"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => confirmThen("reject", () => act("reject", () => review("REJECT"), "Request rejected."))}
                    className="btn-outline btn-sm flex-1 !border-danger !text-danger hover:!bg-danger hover:!text-white"
                  >
                    {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    {confirm === "reject" ? "Confirm reject" : "Reject"}
                  </button>
                </div>
                <p className="text-xs text-parchment-muted">
                  {dirty
                    ? "Save your edits before approving."
                    : request.paymentStatus === "PAID"
                      ? "Rejecting a paid request doesn't refund automatically — refund it from the Razorpay dashboard."
                      : "The note below is shown to the partner."}
                </p>
              </div>
            )}

            {card.issued && (card.status === "ACTIVE" || card.status === "INACTIVE") && (
              <div className={`grid grid-cols-2 gap-2 ${request ? "mt-4 border-t border-border-soft pt-4" : ""}`}>
                {card.status === "ACTIVE" ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => confirmThen("deactivate", () => act("deactivate", () => partnerCardService.setStatus(card.id, "INACTIVE"), "Card deactivated."))}
                    className="btn-outline btn-sm !border-danger !text-danger hover:!bg-danger hover:!text-white"
                  >
                    {busy === "deactivate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    {confirm === "deactivate" ? "Confirm" : "Deactivate"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act("activate", () => partnerCardService.setStatus(card.id, "ACTIVE"), "Card activated.")}
                    className="btn-gold btn-sm"
                  >
                    {busy === "activate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} Activate
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy !== null || Boolean(request)}
                  onClick={() => confirmThen("reissue", () => act("reissue", () => partnerCardService.adminReissue(card.id), "Card reissued with a new QR code."))}
                  className="btn-outline btn-sm"
                >
                  {busy === "reissue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {confirm === "reissue" ? "Confirm" : "Reissue (free)"}
                </button>
                <p className="col-span-2 text-xs text-parchment-muted">
                  An academy reissue is free, rotates the QR code (older prints show as superseded) and is logged in the history.
                </p>
              </div>
            )}
            {!request && card.status === "REJECTED" && (
              <p className="text-sm text-parchment-muted">Rejected. The partner can update their details and resubmit.</p>
            )}
          </div>

          {/* edit form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act("save", () => partnerCardService.update(card.id, pending), "Card details saved.");
            }}
            className="space-y-3"
          >
            <p className="label-field">Card details</p>
            <EditField label="Full name" value={draft.fullName} onChange={(v) => set({ fullName: v })} max={40} />
            <EditField label="Role" value={draft.role} onChange={(v) => set({ role: v })} max={40} />
            <EditField label="Location" value={draft.location} onChange={(v) => set({ location: v })} max={48} />
            <EditField label="Email" value={draft.email} onChange={(v) => set({ email: v })} max={60} type="email" />
            <EditField label="Mobile" value={draft.phone} onChange={(v) => set({ phone: v })} max={17} />
            {!request && (
              <label className="block">
                <span className="text-xs font-semibold text-parchment-muted">Valid from</span>
                <input type="date" value={draft.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className="input-field !py-2" />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-parchment-muted">Reissue fee for this partner (₹)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={draft.reissueFee}
                onChange={(e) => set({ reissueFee: e.target.value })}
                placeholder="Default from settings"
                className="input-field !py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-parchment-muted">Note to partner</span>
              <textarea value={draft.adminNote} onChange={(e) => set({ adminNote: e.target.value })} maxLength={500} rows={2} className="input-field !py-2" />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPhoto} />
              <button type="button" onClick={() => photoRef.current?.click()} className="btn-ghost btn-sm border border-border-soft">
                <Camera className="h-4 w-4" /> Photo
              </button>
              <input ref={signatureRef} type="file" accept="image/*" className="hidden" onChange={onSignature} />
              <button type="button" onClick={() => signatureRef.current?.click()} className="btn-ghost btn-sm border border-border-soft">
                Signature
              </button>
              {draft.signature && (
                <button type="button" onClick={() => set({ signature: null })} className="btn-ghost btn-sm col-span-2 text-xs">
                  Use default signature mark
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={!dirty || busy !== null} className="btn-gold btn-sm flex-1">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
              </button>
              <button type="button" disabled={!dirty || busy !== null} onClick={() => setDraft(toDraft(card))} className="btn-ghost btn-sm">
                Discard
              </button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-ink px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-parchment-muted">{label}</dt>
      <dd className="text-sm font-semibold text-parchment">{value}</dd>
    </div>
  );
}

function HistoryTable({ history }: { history: PartnerCardRequestSummary[] }) {
  return (
    <div className="border-t border-border-soft pt-4">
      <p className="label-field">Reissue history</p>
      {history.length === 0 ? (
        <p className="text-sm text-parchment-muted">No requests yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="uppercase tracking-wider text-parchment-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Submitted</th>
                <th className="py-2 pr-3 font-semibold">Type</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Payment</th>
                <th className="py-2 pr-3 font-semibold">Reviewed</th>
                <th className="py-2 font-semibold">Reason / note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {history.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-3 text-parchment-muted">{formatDate(r.createdAt)}</td>
                  <td className="py-2 pr-3 text-parchment">
                    {r.kind === "FREE" ? "Free card" : "Reissue"}
                    {r.issueNumber && <span className="text-parchment-muted"> · #{r.issueNumber}</span>}
                  </td>
                  <td className="py-2 pr-3 text-parchment">{REQUEST_STATUS_LABEL[r.status]}</td>
                  <td className="py-2 pr-3 text-parchment-muted">
                    {PAYMENT_STATUS_LABEL[r.paymentStatus]}
                    {r.feeInPaise > 0 && ` · ${formatInr(r.feeInPaise)}`}
                    {r.paidAt && ` · ${formatDate(r.paidAt)}`}
                  </td>
                  <td className="py-2 pr-3 text-parchment-muted">{r.reviewedAt ? formatDate(r.reviewedAt) : "—"}</td>
                  <td className="py-2 text-parchment-muted">{[r.reason, r.adminNote].filter(Boolean).join(" — ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  max,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-parchment-muted">{label}</span>
      <input type={type} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} className="input-field !py-2" />
    </label>
  );
}

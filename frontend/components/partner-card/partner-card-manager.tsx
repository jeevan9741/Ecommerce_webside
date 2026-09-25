"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import {
  BadgeCheck,
  Camera,
  Clock,
  CreditCard,
  ExternalLink,
  Gift,
  Loader2,
  QrCode,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldX,
  Upload,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatDate, formatInr } from "@/lib/format";
import { renderQrSvg, type PartnerCardArt } from "@/lib/partner-card/design";
import {
  PAYMENT_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  qrUrlFor,
  toCardArt,
  VERIFY_ORIGIN,
  watermarkFor,
  type PartnerCard,
  type PartnerCardRequest,
  type PartnerCardRequestSummary,
  type PartnerCardView,
} from "@/lib/partner-card/types";
import { partnerCardService, type PartnerCardDefaults } from "@/services/partnerCardService";
import { fileToPhotoDataUrl, photoFileError } from "@/components/dashboard/profile-photo";
import { Modal } from "@/components/admin/modal";
import { ToastStack, useToasts } from "@/components/toast";
import { PartnerCardPreview } from "./card-preview";
import { PartnerCardExports } from "./card-exports";

/** Photo window on the card is 275 × 270; 2× gives a sharp 300 DPI print. */
export const CARD_PHOTO_W = 550;
export const CARD_PHOTO_H = 540;

// Dashboard copy for each stage of the one-free-card policy.
const MSG_BEFORE_ISSUE = "Submit your Partner ID Card request.";
const MSG_AFTER_ISSUE = "Your free Partner ID Card has already been issued.";
const MSG_REISSUE_PAID = "Additional ID card requests require payment.";
const MSG_FREE_USED = "You have already received your free Partner ID Card. Reissue charges apply.";

export async function readCardPhoto(file: File): Promise<string> {
  const error = photoFileError(file);
  if (error) throw new Error(error);
  return fileToPhotoDataUrl(file, CARD_PHOTO_W, CARD_PHOTO_H);
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again.") {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

type Push = (type: "success" | "error", message: string) => void;

export function PartnerCardManager({ initial, defaults }: { initial: PartnerCardView; defaults: PartnerCardDefaults }) {
  const [view, setView] = useState(initial);
  const { toasts, push, dismiss } = useToasts();
  const { card, policy } = view;
  // The free request form: no card yet, or the first request was rejected before any issue.
  const showFreeForm = !card || (!card.issued && card.status === "REJECTED");

  return (
    <section className="space-y-6">
      {/* Checkout is only needed for paid reissues; load it lazily. */}
      {policy.issued && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />}

      <PolicyBanner view={view} />

      {showFreeForm ? (
        <CardRequestForm
          mode="free"
          card={card}
          defaults={defaults}
          onSubmit={async (body) => {
            const next = await partnerCardService.request({ ...body, photo: body.photo! });
            setView(next);
            push("success", "Request sent. You'll be able to download your card once an admin approves it.");
          }}
          onError={(m) => push("error", m)}
        />
      ) : (
        <IssuedCard view={view} defaults={defaults} onChange={setView} push={push} />
      )}

      {view.history.length > 0 && <RequestHistory history={view.history} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}

function Banner({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof BadgeCheck;
  tone: "ok" | "wait" | "bad" | "info";
  title: string;
  children?: React.ReactNode;
}) {
  const cls = {
    ok: ["border-emerald/30 bg-emerald/5", "text-emerald"],
    wait: ["border-amber-300 bg-amber-50", "text-amber-500"],
    bad: ["border-danger/30 bg-danger/5", "text-danger"],
    info: ["border-gold-500/30 bg-gold-500/5", "text-gold-500"],
  }[tone];
  return (
    <div className={`flex gap-3 rounded-2xl border p-4 ${cls[0]}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cls[1]}`} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-parchment">{title}</p>
        {children && <div className="mt-0.5 text-parchment-muted">{children}</div>}
      </div>
    </div>
  );
}

function PolicyBanner({ view }: { view: PartnerCardView }) {
  const { card, policy } = view;
  const note = card?.adminNote && card.status !== "ACTIVE" && (
    <p className="mt-2 text-parchment">
      <span className="font-semibold">Note from the academy:</span> {card.adminNote}
    </p>
  );

  if (!card) {
    return (
      <Banner icon={Gift} tone="info" title={MSG_BEFORE_ISSUE}>
        Your first Partner ID Card is free. An admin reviews your details and photo before it&apos;s issued.
      </Banner>
    );
  }
  if (!card.issued) {
    return card.status === "REJECTED" ? (
      <Banner icon={ShieldX} tone="bad" title="Your request wasn't approved">
        {MSG_BEFORE_ISSUE} Update your details below and submit again — it&apos;s still free.
        {note}
      </Banner>
    ) : (
      <Banner icon={Clock} tone="wait" title={`Awaiting admin approval · ${card.partnerId}`}>
        We&apos;ll review your details and photo. The card below is a preview until it&apos;s approved.
      </Banner>
    );
  }
  if (card.status === "INACTIVE") {
    return (
      <Banner icon={ShieldAlert} tone="bad" title={`This card has been deactivated · ${card.partnerId}`}>
        It no longer verifies as valid. Contact the academy if you think this is a mistake.
        {note}
      </Banner>
    );
  }
  return (
    <Banner icon={BadgeCheck} tone="ok" title={`${MSG_AFTER_ISSUE} · ${card.partnerId}`}>
      Issued {formatDate(policy.firstIssuedAt ?? card.issuedAt ?? card.createdAt)}
      {policy.issueCount > 1 && ` · current card is issue #${policy.issueCount} (${formatDate(card.issuedAt!)})`}. Download or print it
      any time below.
    </Banner>
  );
}

// ---------- request form (free request and reissue) ----------

interface RequestBody {
  fullName: string;
  location: string;
  phone: string;
  photo?: string;
  reason?: string;
}

function CardRequestForm({
  mode,
  card,
  defaults,
  feeInPaise = 0,
  onSubmit,
  onCancel,
  onError,
}: {
  mode: "free" | "reissue";
  card: PartnerCard | null;
  defaults: PartnerCardDefaults;
  feeInPaise?: number;
  onSubmit: (body: RequestBody) => Promise<void>;
  onCancel?: () => void;
  onError: (message: string) => void;
}) {
  const reissue = mode === "reissue";
  const [fullName, setFullName] = useState(card?.fullName ?? defaults.fullName.replace(/[^A-Za-z .'-]/g, "").trim());
  const [location, setLocation] = useState(card?.location ?? "");
  const [phone, setPhone] = useState(card?.phone ?? defaults.phone);
  // For a reissue a new photo is optional; null keeps the current one.
  const [newPhoto, setNewPhoto] = useState<string | null>(reissue ? null : card?.photo ?? null);
  const [reason, setReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const shownPhoto = newPhoto ?? (reissue ? card?.photo ?? null : null);

  const art: PartnerCardArt = useMemo(
    () => ({
      fullName: fullName || "Your Name",
      partnerId: card?.partnerId ?? "ECTA-BP•••",
      role: card?.role ?? "Authorized Business Partner",
      location: location || "Your City, State",
      email: defaults.email,
      phone: phone || "",
      validFrom: reissue ? card?.validFrom ?? null : null,
      photo: shownPhoto,
      signature: card?.signature ?? null,
      qrUrl: `${VERIFY_ORIGIN}/verify`,
    }),
    [fullName, location, phone, shownPhoto, card, defaults.email, reissue]
  );

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      setNewPhoto(await readCardPhoto(file));
      setErrors((prev) => ({ ...prev, photo: "" }));
    } catch (err) {
      onError(errorMessage(err, "We couldn't read that image. Please try another photo."));
    } finally {
      setProcessing(false);
    }
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(fullName.trim())) next.fullName = "Enter your name in English letters (2–40 characters).";
    if (!/^[A-Za-z0-9 .,'()/-]{2,48}$/.test(location.trim())) next.location = "Enter your city and state (2–48 characters).";
    if (!/^\+?[0-9 ]{10,17}$/.test(phone.trim())) next.phone = "Enter a valid 10-digit mobile number.";
    if (!reissue && !newPhoto) next.photo = "Upload a clear, front-facing photo.";
    if (reissue && reason.trim().length < 3) next.reason = "Tell us why you need a new card.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        location: location.trim(),
        phone: phone.trim(),
        ...(newPhoto ? { photo: newPhoto } : {}),
        ...(reissue ? { reason: reason.trim() } : {}),
      });
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = reissue
    ? feeInPaise > 0
      ? `Continue to payment · ${formatInr(feeInPaise)}`
      : "Submit reissue request"
    : card
      ? "Resubmit for approval"
      : "Submit for approval";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6" noValidate>
        <div>
          <h2 className="text-base font-semibold text-parchment">
            {reissue ? "Reissue Partner ID Card" : card ? "Update and resubmit" : "Request your free Partner ID Card"}
          </h2>
          <p className="mt-1 text-xs text-parchment-muted">
            {reissue
              ? "Update anything that should change on the new card. Your current card stays valid until the new one is issued."
              : "These details print on your card exactly as entered. The preview updates as you type."}
          </p>
        </div>

        {reissue && feeInPaise > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">{MSG_FREE_USED}</p>
            <p className="mt-1">
              Reissue fee: <span className="font-bold">{formatInr(feeInPaise)}</span>, paid online before admin approval.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex h-[88px] w-[90px] shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gold-500/40 bg-gold-500/5">
            {shownPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
              <img src={shownPhoto} alt="Card photo" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-6 w-6 text-gold-500" />
            )}
          </div>
          <div className="min-w-0">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={processing} className="btn-outline btn-sm">
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {shownPhoto ? "Change photo" : "Upload photo"}
            </button>
            <p className="field-hint">
              {reissue ? "Optional — keeps your current photo if unchanged." : "Front-facing, plain background. JPG/PNG/WebP up to 5 MB."}
            </p>
            {errors.photo && <p className="field-error">{errors.photo}</p>}
          </div>
        </div>

        <Field label="Full name" error={errors.fullName}>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={40} className={`input-field ${errors.fullName ? "input-error" : ""}`} autoComplete="name" />
        </Field>
        <Field label="Location (City, State)" error={errors.location}>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={48} placeholder="Rayadurgam, Andhra Pradesh" className={`input-field ${errors.location ? "input-error" : ""}`} />
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={17} className={`input-field ${errors.phone ? "input-error" : ""}`} autoComplete="tel" />
        </Field>
        {reissue ? (
          <Field label="Reason for reissue" error={errors.reason}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Lost card, damaged, details changed…" className={`input-field ${errors.reason ? "input-error" : ""}`} />
          </Field>
        ) : (
          <Field label="Email">
            <input value={defaults.email} disabled className="input-field opacity-70" />
            <p className="field-hint">Your verified account email is printed on the card.</p>
          </Field>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={submitting || processing} className="btn-gold flex-1">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : reissue && feeInPaise > 0 ? <CreditCard className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {submitLabel}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={submitting} className="btn-ghost">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="card p-5 sm:p-6">
        <p className="label-field">{reissue ? "Preview of the new card" : "Live preview"}</p>
        <PartnerCardPreview art={art} watermark="PREVIEW" className="mt-3" />
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-field">{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

// ---------- reissue payment ----------

/** Opens Razorpay Checkout for the request's fee; resolves once the server has confirmed the payment. */
async function payForRequest(request: PartnerCardRequest, defaults: PartnerCardDefaults): Promise<PartnerCardView & { paid: boolean }> {
  if (typeof window.Razorpay !== "function") throw new Error("Payment service is still loading — please try again in a moment.");
  const checkout = await partnerCardService.pay(request.id);

  await new Promise<void>((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: checkout.keyId,
      amount: checkout.amountInPaise,
      currency: checkout.currency,
      order_id: checkout.razorpayOrderId,
      name: "E-Commerce Training Academy",
      description: checkout.description,
      prefill: { name: request.fullName, email: defaults.email, contact: request.phone },
      theme: { color: "#2563eb" },
      handler: () => resolve(),
      modal: { ondismiss: () => reject(new Error("Payment cancelled. You can pay any time from this page.")) },
    });
    rzp.open();
  });

  // Checkout reported success; the server confirms with Razorpay itself (the webhook also lands).
  let last: PartnerCardView & { paid: boolean } = { ...(await partnerCardService.confirm(request.id)) };
  for (let i = 0; !last.paid && i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    last = await partnerCardService.confirm(request.id);
  }
  return last;
}

// ---------- issued card ----------

function IssuedCard({
  view,
  defaults,
  onChange,
  push,
}: {
  view: PartnerCardView;
  defaults: PartnerCardDefaults;
  onChange: (view: PartnerCardView) => void;
  push: Push;
}) {
  const card = view.card!;
  const { openRequest, policy } = view;
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = card.status === "ACTIVE";
  // The photo can still change while the first (free) request is being reviewed — not after issue.
  const firstRequestPending = !card.issued && card.status === "PENDING";

  const art = useMemo(() => {
    const base = toCardArt(card);
    return pendingPhoto ? { ...base, photo: pendingPhoto } : base;
  }, [card, pendingPhoto]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      setPendingPhoto(await readCardPhoto(file));
    } catch (err) {
      push("error", errorMessage(err, "We couldn't read that image. Please try another photo."));
    } finally {
      setProcessing(false);
    }
  }

  async function savePhoto() {
    if (!pendingPhoto) return;
    setSavingPhoto(true);
    try {
      onChange(await partnerCardService.updatePhoto(pendingPhoto));
      setPendingPhoto(null);
      push("success", "Photo updated on your request.");
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setSavingPhoto(false);
    }
  }

  async function pay(request: PartnerCardRequest) {
    setPaying(true);
    try {
      const result = await payForRequest(request, defaults);
      onChange(result);
      push(
        result.paid ? "success" : "error",
        result.paid
          ? "Payment received. Your reissue request is now with the academy for approval."
          : "We're still confirming your payment — refresh this page in a minute."
      );
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  async function cancel(request: PartnerCardRequest) {
    setCancelling(true);
    try {
      onChange(await partnerCardService.cancel(request.id));
      push("success", "Reissue request cancelled.");
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  if (reissuing) {
    return (
      <CardRequestForm
        mode="reissue"
        card={card}
        defaults={defaults}
        feeInPaise={policy.paymentRequired ? policy.reissueFeeInPaise : 0}
        onCancel={() => setReissuing(false)}
        onError={(m) => push("error", m)}
        onSubmit={async (body) => {
          const next = await partnerCardService.reissue({ ...body, reason: body.reason! });
          onChange(next);
          setReissuing(false);
          if (next.openRequest?.status === "AWAITING_PAYMENT") {
            push("success", "Reissue request created. Complete the payment to send it for approval.");
            void pay(next.openRequest);
          } else {
            push("success", "Reissue request sent for approval.");
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <PartnerCardExports partnerId={card.partnerId} disabled={!active} onError={(m) => push("error", m)} />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {firstRequestPending && (
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={processing || savingPhoto}
                className="btn-ghost btn-sm border border-border-soft"
              >
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Update Photo
              </button>
            </>
          )}
          {card.issued && (
            <button type="button" onClick={() => setShowQr(true)} className="btn-ghost btn-sm border border-border-soft">
              <QrCode className="h-4 w-4" /> View QR
            </button>
          )}
        </div>
      </div>

      {pendingPhoto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-gold-500/30 bg-gold-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-parchment">New photo shown in the preview. Save it to update your request.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPendingPhoto(null)} disabled={savingPhoto} className="btn-ghost btn-sm">
              <X className="h-4 w-4" /> Cancel
            </button>
            <button type="button" onClick={savePhoto} disabled={savingPhoto} className="btn-gold btn-sm">
              {savingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Save photo
            </button>
          </div>
        </div>
      )}

      {card.issued && active && (
        <ReissuePanel
          view={view}
          paying={paying}
          cancelling={cancelling}
          onStart={() => setReissuing(true)}
          onPay={() => openRequest && pay(openRequest)}
          onCancel={() => openRequest && cancel(openRequest)}
        />
      )}

      <div className="card p-5 sm:p-6">
        <PartnerCardPreview art={art} watermark={watermarkFor(card.status)} />
      </div>

      {showQr && <QrDialog card={card} onClose={() => setShowQr(false)} />}
    </div>
  );
}

function ReissuePanel({
  view,
  paying,
  cancelling,
  onStart,
  onPay,
  onCancel,
}: {
  view: PartnerCardView;
  paying: boolean;
  cancelling: boolean;
  onStart: () => void;
  onPay: () => void;
  onCancel: () => void;
}) {
  const { openRequest: request, policy } = view;

  if (request?.kind === "REISSUE") {
    const awaitingPayment = request.status === "AWAITING_PAYMENT";
    return (
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          <p className="flex items-center gap-2 font-semibold text-parchment">
            <RefreshCw className="h-4 w-4 text-gold-500" /> Reissue request · {REQUEST_STATUS_LABEL[request.status]}
          </p>
          <p className="mt-1 text-parchment-muted">
            {awaitingPayment
              ? `${MSG_REISSUE_PAID} Pay ${formatInr(request.feeInPaise)} to send it for approval.`
              : `Payment: ${PAYMENT_STATUS_LABEL[request.paymentStatus]}${request.feeInPaise > 0 ? ` (${formatInr(request.feeInPaise)})` : ""}. The academy will review it shortly.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {awaitingPayment && (
            <button type="button" onClick={onPay} disabled={paying} className="btn-gold btn-sm">
              {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay {formatInr(request.feeInPaise)}
            </button>
          )}
          {request.paymentStatus !== "PAID" && request.paymentStatus !== "WAIVED" && (
            <button type="button" onClick={onCancel} disabled={cancelling || paying} className="btn-ghost btn-sm border border-border-soft">
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel request
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-parchment">Need another card?</p>
        <p className="mt-1 text-parchment-muted">
          {policy.paymentRequired ? (
            <>
              {MSG_REISSUE_PAID} Reissue fee: <span className="font-semibold text-parchment">{formatInr(policy.reissueFeeInPaise)}</span>.
            </>
          ) : policy.nextCardFree ? (
            `You have ${policy.freeCardsRemaining} free card${policy.freeCardsRemaining === 1 ? "" : "s"} remaining. Reissues still need admin approval.`
          ) : (
            "Reissues need admin approval."
          )}
        </p>
      </div>
      <button type="button" onClick={onStart} className="btn-outline btn-sm shrink-0">
        <RefreshCw className="h-4 w-4" /> Reissue Partner ID Card
      </button>
    </div>
  );
}

function RequestHistory({ history }: { history: PartnerCardRequestSummary[] }) {
  return (
    <div className="card p-5 sm:p-6">
      <p className="label-field">Request history</p>
      <div className="table-scroll">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-parchment-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Date</th>
              <th className="py-2 pr-3 font-semibold">Request</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Payment</th>
              <th className="py-2 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {history.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-3 text-parchment-muted">{formatDate(r.createdAt)}</td>
                <td className="py-2 pr-3 text-parchment">
                  {r.kind === "FREE" ? "Free card" : "Reissue"}
                  {r.issueNumber && <span className="text-parchment-muted"> · issue #{r.issueNumber}</span>}
                </td>
                <td className="py-2 pr-3 text-parchment">{REQUEST_STATUS_LABEL[r.status]}</td>
                <td className="py-2 pr-3 text-parchment-muted">
                  {PAYMENT_STATUS_LABEL[r.paymentStatus]}
                  {r.feeInPaise > 0 && ` · ${formatInr(r.feeInPaise)}`}
                </td>
                <td className="py-2 text-parchment-muted">{r.adminNote ?? r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QrDialog({ card, onClose }: { card: PartnerCard; onClose: () => void }) {
  const url = qrUrlFor(card);
  const svg = useMemo(() => renderQrSvg(url, 256), [url]);
  return (
    <Modal title={`QR code · ${card.partnerId}`} onClose={onClose}>
      <div className="mx-auto w-full max-w-[260px] rounded-2xl border border-border-soft bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mt-4 break-all text-center font-mono text-xs text-parchment-muted">{url}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={card.qrCodeUrl} target="_blank" className="btn-outline btn-sm">
          <ExternalLink className="h-4 w-4" /> Open verification page
        </Link>
      </div>
    </Modal>
  );
}

"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Camera,
  Clock,
  ExternalLink,
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
import { renderQrSvg, type PartnerCardArt } from "@/lib/partner-card/design";
import { qrUrlFor, toCardArt, VERIFY_ORIGIN, watermarkFor, type PartnerCard } from "@/lib/partner-card/types";
import { partnerCardService, type PartnerCardDefaults } from "@/services/partnerCardService";
import { fileToPhotoDataUrl, photoFileError } from "@/components/dashboard/profile-photo";
import { Modal } from "@/components/admin/modal";
import { ToastStack, useToasts } from "@/components/toast";
import { PartnerCardPreview } from "./card-preview";
import { PartnerCardExports } from "./card-exports";

/** Photo window on the card is 275 × 270; 2× gives a sharp 300 DPI print. */
export const CARD_PHOTO_W = 550;
export const CARD_PHOTO_H = 540;

export async function readCardPhoto(file: File): Promise<string> {
  const error = photoFileError(file);
  if (error) throw new Error(error);
  return fileToPhotoDataUrl(file, CARD_PHOTO_W, CARD_PHOTO_H);
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again.") {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

export function PartnerCardManager({
  initialCard,
  defaults,
}: {
  initialCard: PartnerCard | null;
  defaults: PartnerCardDefaults;
}) {
  const [card, setCard] = useState(initialCard);
  const { toasts, push, dismiss } = useToasts();
  const showForm = !card || card.status === "REJECTED";

  return (
    <section className="space-y-6">
      {card && <StatusBanner card={card} />}
      {showForm ? (
        <RequestForm
          card={card}
          defaults={defaults}
          onSubmitted={(next) => {
            setCard(next);
            push("success", "Request sent. You'll be able to download your card once an admin approves it.");
          }}
          onError={(m) => push("error", m)}
        />
      ) : (
        <IssuedCard card={card} onChange={setCard} push={push} />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}

function StatusBanner({ card }: { card: PartnerCard }) {
  const tone = {
    ACTIVE: {
      icon: BadgeCheck,
      cls: "border-emerald/30 bg-emerald/5",
      iconCls: "text-emerald",
      title: "Your Partner ID card is active",
      body: "Download or print it below. Anyone can scan the QR code to verify you're an authorized partner.",
    },
    PENDING: {
      icon: Clock,
      cls: "border-amber-300 bg-amber-50",
      iconCls: "text-amber-500",
      title: "Awaiting admin approval",
      body: "We'll review your details and photo. The card below is a preview until it's approved.",
    },
    REJECTED: {
      icon: ShieldX,
      cls: "border-danger/30 bg-danger/5",
      iconCls: "text-danger",
      title: "Your request wasn't approved",
      body: "Update your details below and submit again.",
    },
    INACTIVE: {
      icon: ShieldAlert,
      cls: "border-danger/30 bg-danger/5",
      iconCls: "text-danger",
      title: "This card has been deactivated",
      body: "It no longer verifies as valid. Contact the academy if you think this is a mistake.",
    },
  }[card.status];
  const Icon = tone.icon;

  return (
    <div className={`flex gap-3 rounded-2xl border p-4 ${tone.cls}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.iconCls}`} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-parchment">
          {tone.title} <span className="font-mono text-xs text-parchment-muted">· {card.partnerId}</span>
        </p>
        <p className="mt-0.5 text-parchment-muted">{tone.body}</p>
        {card.adminNote && card.status !== "ACTIVE" && (
          <p className="mt-2 text-parchment">
            <span className="font-semibold">Note from the academy:</span> {card.adminNote}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- request / resubmit ----------

function RequestForm({
  card,
  defaults,
  onSubmitted,
  onError,
}: {
  card: PartnerCard | null;
  defaults: PartnerCardDefaults;
  onSubmitted: (card: PartnerCard) => void;
  onError: (message: string) => void;
}) {
  const [fullName, setFullName] = useState(card?.fullName ?? defaults.fullName.replace(/[^A-Za-z .'-]/g, "").trim());
  const [location, setLocation] = useState(card?.location ?? "");
  const [phone, setPhone] = useState(card?.phone ?? defaults.phone);
  const [photo, setPhoto] = useState<string | null>(card?.photo ?? null);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const art: PartnerCardArt = useMemo(
    () => ({
      fullName: fullName || "Your Name",
      partnerId: card?.partnerId ?? "ECTA-BP•••",
      role: card?.role ?? "Authorized Business Partner",
      location: location || "Your City, State",
      email: defaults.email,
      phone: phone || "",
      validFrom: null,
      photo,
      signature: null,
      qrUrl: `${VERIFY_ORIGIN}/verify`,
    }),
    [fullName, location, phone, photo, card, defaults.email]
  );

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      setPhoto(await readCardPhoto(file));
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
    if (!photo) next.photo = "Upload a clear, front-facing photo.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate() || !photo) return;
    setSubmitting(true);
    try {
      const { card: next } = await partnerCardService.request({
        fullName: fullName.trim(),
        location: location.trim(),
        phone: phone.trim(),
        photo,
      });
      onSubmitted(next);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <form onSubmit={submit} className="card space-y-4 p-5 sm:p-6" noValidate>
        <div>
          <h2 className="text-base font-semibold text-parchment">{card ? "Update and resubmit" : "Request your Partner ID card"}</h2>
          <p className="mt-1 text-xs text-parchment-muted">
            These details print on your card exactly as entered. The preview updates as you type.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex h-[88px] w-[90px] shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gold-500/40 bg-gold-500/5">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL
              <img src={photo} alt="Card photo" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-6 w-6 text-gold-500" />
            )}
          </div>
          <div className="min-w-0">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={processing} className="btn-outline btn-sm">
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {photo ? "Change photo" : "Upload photo"}
            </button>
            <p className="field-hint">Front-facing, plain background. JPG/PNG/WebP up to 5 MB.</p>
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
        <Field label="Email">
          <input value={defaults.email} disabled className="input-field opacity-70" />
          <p className="field-hint">Your verified account email is printed on the card.</p>
        </Field>

        <button type="submit" disabled={submitting || processing} className="btn-gold btn-block">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {card ? "Resubmit for approval" : "Submit for approval"}
        </button>
      </form>

      <div className="card p-5 sm:p-6">
        <p className="label-field">Live preview</p>
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

// ---------- issued card ----------

function IssuedCard({
  card,
  onChange,
  push,
}: {
  card: PartnerCard;
  onChange: (card: PartnerCard) => void;
  push: (type: "success" | "error", message: string) => void;
}) {
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [confirmQr, setConfirmQr] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = card.status === "ACTIVE";

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
      const { card: next } = await partnerCardService.updatePhoto(pendingPhoto);
      onChange(next);
      setPendingPhoto(null);
      push("success", "Photo updated on your card.");
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setSavingPhoto(false);
    }
  }

  async function regenerate() {
    if (!confirmQr) {
      setConfirmQr(true);
      setTimeout(() => setConfirmQr(false), 5000);
      return;
    }
    setConfirmQr(false);
    setRegenerating(true);
    try {
      const { card: next } = await partnerCardService.regenerateQr();
      onChange(next);
      push("success", "New QR code generated. Download or print your card again — older prints now show as superseded.");
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <PartnerCardExports partnerId={card.partnerId} disabled={!active} onError={(m) => push("error", m)} />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={processing || savingPhoto || card.status === "INACTIVE"}
            className="btn-ghost btn-sm border border-border-soft"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Update Photo
          </button>
          <button type="button" onClick={() => setShowQr(true)} className="btn-ghost btn-sm border border-border-soft">
            <QrCode className="h-4 w-4" /> View QR
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={!active || regenerating}
            className={`btn-ghost btn-sm border ${confirmQr ? "border-danger !text-danger" : "border-border-soft"}`}
          >
            {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {confirmQr ? "Tap again to confirm" : "Regenerate QR"}
          </button>
        </div>
      </div>

      {pendingPhoto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-gold-500/30 bg-gold-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-parchment">New photo shown in the preview. Save it to update your card.</p>
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

      <div className="card p-5 sm:p-6">
        <PartnerCardPreview art={art} watermark={watermarkFor(card.status)} />
      </div>

      {showQr && <QrDialog card={card} onClose={() => setShowQr(false)} />}
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
        <Link href={`/partner/${card.partnerId}`} target="_blank" className="btn-ghost btn-sm">
          <BadgeCheck className="h-4 w-4" /> Partner profile
        </Link>
      </div>
    </Modal>
  );
}

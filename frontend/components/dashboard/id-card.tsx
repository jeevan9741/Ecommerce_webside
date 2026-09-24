"use client";

import { Download, ImagePlus, Loader2, Save, ShieldCheck, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { fileToPhotoDataUrl, photoFileError, useStoredPhoto } from "@/components/dashboard/profile-photo";
import { useToasts, ToastStack } from "@/components/toast";

export interface IdCardDetails {
  userId: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  memberSince: string;
  packages: string[];
}

const ACADEMY_NAME = "E-Commerce Training Academy";

/** Stable, human-readable ID derived from the account id. */
function studentId(userId: string) {
  return `ECA-${userId.slice(-8).toUpperCase()}`;
}

// Passport photo proportions (35 × 45 mm).
const PASSPORT_W = 350;
const PASSPORT_H = 450;

export function IdCard(details: IdCardDetails) {
  const [photo, setPhoto] = useStoredPhoto("idCard", details.userId);
  const [pending, setPending] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toasts, push, dismiss } = useToasts();
  const id = studentId(details.userId);
  const packagesText = details.packages.length > 0 ? details.packages.join(", ") : "No package yet";
  // Show the chosen-but-unsaved photo in the preview so the student sees the result before applying it.
  const shownPhoto = pending ?? photo;

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fileError = photoFileError(file);
    if (fileError) {
      push("error", fileError);
      return;
    }
    setProcessing(true);
    try {
      setPending(await fileToPhotoDataUrl(file, PASSPORT_W, PASSPORT_H));
    } catch {
      push("error", "We couldn't read that image. Please try another photo.");
    } finally {
      setProcessing(false);
    }
  }

  function applyPhoto() {
    if (!pending) return;
    if (setPhoto(pending)) {
      setPending(null);
      push("success", "Photo applied to your ID card.");
    } else {
      push("error", "Your browser blocked saving the photo. Please check your site settings.");
    }
  }

  async function download() {
    setBusy(true);
    try {
      const url = await renderCardPng({ ...details, photo, id, packagesText });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}-id-card.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>

      <div className="card mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex h-[90px] w-[70px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-gold-500/40 bg-gold-500/5">
          {shownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img src={shownPhoto} alt="Passport photo preview" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6 text-gold-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-parchment">Passport Size Photo</p>
          <p className="mt-0.5 text-xs text-parchment-muted">
            {pending ? "Preview ready — save to apply it to your card." : "JPG, PNG or WebP, up to 5 MB. Cropped to 35 × 45 mm."}
          </p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />
        <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
            className="btn-outline !px-5 !py-2.5 text-sm"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {photo || pending ? "Change Photo" : "Upload Photo"}
          </button>
          <button type="button" onClick={applyPhoto} disabled={!pending} className="btn-gold !px-5 !py-2.5 text-sm">
            <Save className="h-4 w-4" />
            Save &amp; Apply to ID Card
          </button>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-start gap-5 lg:flex-row lg:items-end">
        {/* On-screen preview; the download is redrawn on a canvas at print resolution. */}
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border-soft bg-white shadow-[0_20px_45px_-20px_rgba(37,99,235,0.35)]">
          <div className="flex items-center gap-2 bg-gradient-to-r from-gold-600 to-gold-500 px-5 py-3 text-white">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{ACADEMY_NAME}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-blue-100">Student Identity Card</p>
            </div>
          </div>
          <div className="flex gap-4 p-5">
            <div className="h-[103px] w-20 shrink-0 overflow-hidden rounded-xl border-2 border-gold-100 bg-gradient-to-br from-gold-400 to-gold-600">
              {shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL
                <img src={shownPhoto} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-white">
                  {details.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold text-parchment">{details.name}</p>
              <p className="text-xs font-bold tracking-wider text-gold-500">{id}</p>
              <dl className="mt-2 space-y-0.5 text-xs text-parchment-muted">
                <CardRow label="Username" value={details.username} />
                <CardRow label="Phone" value={details.phone || "—"} />
                <CardRow label="Since" value={details.memberSince} />
              </dl>
            </div>
          </div>
          <div className="border-t border-border-soft bg-blue-50/60 px-5 py-2.5 text-xs text-parchment-muted">
            <span className="font-semibold text-parchment">Package:</span> {packagesText}
          </div>
        </div>

        <button type="button" onClick={download} disabled={busy} className="btn-gold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download ID Card
        </button>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 font-medium text-parchment">{label}:</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Shortens text with an ellipsis so it fits within maxWidth on the canvas. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

async function renderCardPng(
  d: IdCardDetails & { photo: string | null; id: string; packagesText: string },
): Promise<string> {
  // CR80 card proportions (85.6 × 54 mm) at roughly 300 dpi.
  const W = 1012;
  const H = 638;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 36);
  ctx.fill();
  ctx.save();
  ctx.clip();

  const header = ctx.createLinearGradient(0, 0, W, 0);
  header.addColorStop(0, "#1d4ed8");
  header.addColorStop(1, "#2563eb");
  ctx.fillStyle = header;
  ctx.fillRect(0, 0, W, 150);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 44);
  ctx.fillText(fit(ctx, ACADEMY_NAME, W - 100), 50, 78);
  ctx.fillStyle = "#dbeafe";
  ctx.font = font(600, 22);
  ctx.fillText("STUDENT IDENTITY CARD", 50, 118);

  // Photo (or initial) on the left, cropped to a portrait frame.
  const px = 50;
  const py = 190;
  const pw = 230;
  const ph = 290;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 24);
  ctx.clip();
  if (d.photo) {
    const img = await loadImage(d.photo);
    const sw = Math.min(img.width, img.height * (pw / ph));
    const sh = sw * (ph / pw);
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, px, py, pw, ph);
  } else {
    const bg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    bg.addColorStop(0, "#60a5fa");
    bg.addColorStop(1, "#1d4ed8");
    ctx.fillStyle = bg;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(700, 120);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(d.name.charAt(0).toUpperCase(), px + pw / 2, py + ph / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  ctx.strokeStyle = "#dbeafe";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 24);
  ctx.stroke();

  // Details on the right.
  const tx = 330;
  const tw = W - tx - 50;
  ctx.fillStyle = "#0f172a";
  ctx.font = font(700, 48);
  ctx.fillText(fit(ctx, d.name, tw), tx, 240);
  ctx.fillStyle = "#2563eb";
  ctx.font = font(700, 30);
  ctx.fillText(d.id, tx, 285);

  const rows: [string, string][] = [
    ["Username", d.username],
    ["Email", d.email],
    ["Phone", d.phone || "—"],
    ["Member since", d.memberSince],
  ];
  rows.forEach(([label, value], i) => drawLabelled(ctx, font, label, value, tx, 345 + i * 44, tw));

  // Package footer strip.
  ctx.fillStyle = "#eff6ff";
  ctx.fillRect(0, H - 100, W, 100);
  drawLabelled(ctx, font, "Package", d.packagesText, 50, H - 42, W - 100);

  ctx.restore();
  return canvas.toDataURL("image/png");
}

function drawLabelled(
  ctx: CanvasRenderingContext2D,
  font: (weight: number, size: number) => string,
  label: string,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  ctx.fillStyle = "#0f172a";
  ctx.font = font(600, 24);
  ctx.fillText(`${label}:`, x, y);
  const lw = ctx.measureText(`${label}: `).width;
  ctx.fillStyle = "#475569";
  ctx.font = font(400, 24);
  ctx.fillText(fit(ctx, value, maxWidth - lw), x + lw, y);
}

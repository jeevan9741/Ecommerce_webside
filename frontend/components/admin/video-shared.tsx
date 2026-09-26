"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Film, ImagePlus, UploadCloud } from "lucide-react";
import { MAX_VIDEO_BYTES, formatBytes, formatDuration } from "@/services/videoService";
import { readVideoFile, type UploadProgress } from "@/lib/video-upload";

/** Pieces shared by the course-video and demo-video tabs of the admin Videos page. */

export type Push = (type: "success" | "error", message: string) => void;

export interface AdminLanguage {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
}

export function errorText(err: unknown, fallback = "Something went wrong. Please try again.") {
  return err instanceof Error && err.message ? err.message : fallback;
}

export const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function checkThumbnail(file: File) {
  if (!THUMBNAIL_TYPES.includes(file.type)) return "Thumbnails must be JPG, PNG or WebP.";
  if (file.size > 5 * 1024 ** 2) return "Thumbnails can be at most 5 MB.";
  return null;
}

export function Thumb({ url, className = "" }: { url: string | null; className?: string }) {
  return (
    <div className={`flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-[#1424a8] to-[#5b2de6] ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Film className="h-6 w-6 text-white/70" />
      )}
    </div>
  );
}

export function ThumbnailPicker({
  preview,
  onPick,
  onClear,
  auto,
}: {
  preview: string | null;
  onPick: (file: File) => void;
  onClear?: () => void;
  auto?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="label-field">Thumbnail</span>
      <div className="flex items-center gap-3">
        <Thumb url={preview} className="w-36" />
        <div className="space-y-1">
          <input
            ref={ref}
            type="file"
            accept={THUMBNAIL_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onPick(f);
            }}
          />
          <button type="button" onClick={() => ref.current?.click()} className="btn-outline btn-sm">
            <ImagePlus className="h-4 w-4" /> {preview ? "Change image" : "Choose image"}
          </button>
          {onClear && preview && (
            <button type="button" onClick={onClear} className="btn-ghost btn-sm block">
              Remove
            </button>
          )}
          <p className="text-xs text-parchment-muted">
            {auto ? "A frame from the video is used unless you choose an image." : "JPG, PNG or WebP, up to 5 MB."}
          </p>
        </div>
      </div>
    </div>
  );
}

export interface PickedVideo {
  file: File;
  durationSeconds: number | null;
  /** A frame grabbed from the video, for an automatic thumbnail. */
  frame: Blob | null;
}

/** MP4 drop zone: validates type/size and reads duration + a thumbnail frame locally. */
export function VideoFilePicker({
  picked,
  onPicked,
  disabled,
  push,
  emptyLabel = "Choose an MP4 file (up to 2 GB)",
}: {
  picked: PickedVideo | null;
  onPicked: (v: PickedVideo) => void;
  disabled?: boolean;
  push: Push;
  emptyLabel?: string;
}) {
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type !== "video/mp4" && !/\.mp4$/i.test(f.name)) return push("error", "Only MP4 videos can be uploaded.");
    if (f.size > MAX_VIDEO_BYTES) return push("error", `That file is ${formatBytes(f.size)} — the limit is 2 GB.`);
    try {
      const meta = await readVideoFile(f);
      const frame = await meta.captureFrame();
      meta.release();
      onPicked({ file: f, durationSeconds: meta.durationSeconds, frame });
    } catch (err) {
      push("error", `${errorText(err)} You can still upload it.`);
      onPicked({ file: f, durationSeconds: null, frame: null });
    }
  }

  return (
    <label
      className={`input-field flex cursor-pointer flex-col items-center justify-center gap-2 !py-8 text-center ${
        disabled ? "pointer-events-none opacity-60" : "hover:border-gold-500"
      }`}
    >
      <UploadCloud className="h-6 w-6 text-gold-500" />
      {picked ? (
        <span className="text-sm text-parchment">
          <span className="break-all font-semibold">{picked.file.name}</span>
          <span className="block text-xs text-parchment-muted">
            {formatBytes(picked.file.size)} · {formatDuration(picked.durationSeconds)}
          </span>
        </span>
      ) : (
        <span className="text-sm text-parchment-muted">{emptyLabel}</span>
      )}
      <input type="file" accept="video/mp4,.mp4" className="hidden" onChange={onFile} disabled={disabled} />
    </label>
  );
}

/** Progress + transfer speed for one upload at a time. */
export function useUploadTracker() {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const sample = useRef<{ t: number; loaded: number } | null>(null);

  const onProgress = useCallback((p: UploadProgress) => {
    setProgress(p);
    const now = performance.now();
    const last = sample.current;
    if (!last) sample.current = { t: now, loaded: p.loaded };
    else if (now - last.t > 1500) {
      setSpeed(((p.loaded - last.loaded) / (now - last.t)) * 1000);
      sample.current = { t: now, loaded: p.loaded };
    }
  }, []);

  const reset = useCallback(() => {
    sample.current = null;
    setProgress(null);
    setSpeed(null);
  }, []);

  return { progress, speed, onProgress, reset };
}

export function UploadProgressPanel({
  label,
  progress,
  speed,
  determinate,
}: {
  label: string;
  progress: UploadProgress | null;
  speed: number | null;
  /** False while a quick follow-up step runs (thumbnail, saving): shows a full bar. */
  determinate: boolean;
}) {
  const eta = progress && speed && speed > 0 ? (progress.total - progress.loaded) / speed : null;
  const pct = determinate ? progress?.percentage ?? 0 : 100;
  return (
    <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm font-semibold text-parchment">
        <span>{label}</span>
        {determinate && progress && <span>{Math.floor(progress.percentage)}%</span>}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-border-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(pct)}
      >
        <div className="h-full rounded-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {determinate && progress && (
        <p className="mt-2 text-xs text-parchment-muted">
          {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
          {speed ? ` · ${formatBytes(speed)}/s` : ""}
          {eta !== null ? ` · about ${formatDuration(eta)} left` : ""}
        </p>
      )}
      <p className="mt-1 text-xs text-parchment-muted">Keep this tab open until the upload finishes.</p>
    </div>
  );
}

/** Warn before closing the tab mid-upload — a 2 GB upload can't resume after a reload. */
export function useWarnBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

/** Object URL for a Blob that's revoked when the Blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL's lifetime is tied to the blob
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

export function LanguageSelect({
  languages,
  value,
  onChange,
  label = "Language",
  emptyLabel,
  disabled,
}: {
  languages: AdminLanguage[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  /** When set, an empty choice is allowed. */
  emptyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label-field">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field" disabled={disabled}>
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : <option value="" disabled>Choose a language…</option>}
        {languages.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.nativeName && l.nativeName !== l.name ? ` (${l.nativeName})` : ""}
            {l.isActive ? "" : " — inactive"}
          </option>
        ))}
      </select>
    </label>
  );
}

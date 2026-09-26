"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Globe, Loader2, Lock, Pencil, Play, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { formatBytes, formatDuration, videoService, type AdminDemoVideo, type DemoVideoEdit } from "@/services/videoService";
import { uploadToStore } from "@/lib/video-upload";
import { Modal } from "@/components/admin/modal";
import { StreamOnlyVideo } from "@/components/videos/stream-only-video";
import {
  LanguageSelect,
  Thumb,
  ThumbnailPicker,
  UploadProgressPanel,
  VideoFilePicker,
  checkThumbnail,
  errorText,
  useObjectUrl,
  useUploadTracker,
  useWarnBeforeUnload,
  type AdminLanguage,
  type PickedVideo,
  type Push,
} from "@/components/admin/video-shared";

/**
 * Demo videos: one per language, shown on the homepage before registration (no login). Visitors
 * see the demo for the language they pick in "Get Started".
 */
export function DemoVideosPanel({ languages, push }: { languages: AdminLanguage[]; push: Push }) {
  const [videos, setVideos] = useState<AdminDemoVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ video: AdminDemoVideo | null } | null>(null);
  const [previewing, setPreviewing] = useState<AdminDemoVideo | null>(null);

  const load = useCallback(async () => {
    try {
      setVideos((await videoService.demos()).videos);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load demo videos."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  const missing = videos ? languages.filter((l) => l.isActive && !videos.some((v) => v.languageId === l.id)) : [];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-parchment-muted">
          One demo per language, played on the homepage for the language a visitor picks — no login needed. The player
          streams only (no download button).
        </p>
        <button type="button" onClick={() => setDialog({ video: null })} className="btn-gold btn-sm self-start">
          <Plus className="h-4 w-4" /> Upload demo video
        </button>
      </div>

      {missing.length > 0 && (
        <p className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No demo yet for: {missing.map((l) => l.name).join(", ")}. Visitors choosing these languages see a “coming soon” message.
        </p>
      )}

      {error && <p className="card mt-5 p-5 text-sm text-danger">{error}</p>}
      {!videos && !error && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {videos?.map((v) => (
          <DemoCard
            key={v.id}
            video={v}
            onPreview={() => setPreviewing(v)}
            onEdit={() => setDialog({ video: v })}
            onDeleted={() => {
              load();
              push("success", `Deleted the ${v.language.name} demo.`);
            }}
            push={push}
          />
        ))}
      </div>
      {videos?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Play className="h-10 w-10 text-gold-500" />
          <p className="text-sm text-parchment-muted">No demo videos yet.</p>
          <button type="button" onClick={() => setDialog({ video: null })} className="btn-outline btn-sm">
            <UploadCloud className="h-4 w-4" /> Upload the first one
          </button>
        </div>
      )}

      {dialog && videos && (
        <DemoDialog
          video={dialog.video}
          // Each language has one demo: offer only free languages (plus the current one when editing).
          languages={languages.filter((l) => l.id === dialog.video?.languageId || !videos.some((v) => v.languageId === l.id))}
          onClose={() => setDialog(null)}
          onSaved={(v, created) => {
            setDialog(null);
            load();
            push("success", created ? `Uploaded the ${v.language.name} demo.` : "Demo video updated.");
          }}
          push={push}
        />
      )}
      {previewing && (
        <Modal title={previewing.title || `${previewing.language.name} demo`} onClose={() => setPreviewing(null)} size="xl">
          <StreamOnlyVideo
            src={previewing.url}
            poster={previewing.thumbnailUrl ?? undefined}
            autoPlay
            playsInline
            className="aspect-video w-full rounded-xl bg-black"
          />
        </Modal>
      )}
    </div>
  );
}

function DemoCard({
  video: v,
  onPreview,
  onEdit,
  onDeleted,
  push,
}: {
  video: AdminDemoVideo;
  onPreview: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  push: Push;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 5000);
      return;
    }
    setDeleting(true);
    try {
      await videoService.removeDemo(v.id);
      onDeleted();
    } catch (err) {
      push("error", errorText(err));
      setDeleting(false);
    }
  }

  return (
    <div className="card flex flex-col overflow-hidden">
      <button type="button" onClick={onPreview} className="group relative" aria-label={`Preview ${v.language.name} demo`}>
        <Thumb url={v.thumbnailUrl} className="w-full !rounded-none" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
          <Play className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100" />
        </span>
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
          {v.language.name}
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatDuration(v.durationSeconds)}
        </span>
      </button>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-semibold text-parchment">{v.title || <span className="italic text-parchment-muted">Untitled demo</span>}</p>
        {v.description && <p className="mt-1 line-clamp-2 text-sm text-parchment-muted">{v.description}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-parchment-muted">
          {v.sizeBytes !== null && <span>{formatBytes(v.sizeBytes)}</span>}
          <span className="inline-flex items-center gap-1">
            {v.isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {v.isPublic ? "Public CDN" : "Signed links"}
          </span>
          {!v.language.isActive && <span className="font-semibold text-amber-600">Language inactive — not shown</span>}
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onEdit} className="btn-outline btn-sm flex-1">
            <Pencil className="h-4 w-4" /> Edit / Replace
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="btn-outline btn-sm !border-danger !text-danger hover:!bg-danger hover:!text-white"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {confirming ? "Confirm" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

type Stage = "idle" | "video" | "thumbnail" | "saving";

/** Create (video = null) or edit/replace a demo video. */
function DemoDialog({
  video,
  languages,
  onClose,
  onSaved,
  push,
}: {
  video: AdminDemoVideo | null;
  languages: AdminLanguage[];
  onClose: () => void;
  onSaved: (v: AdminDemoVideo, created: boolean) => void;
  push: Push;
}) {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [title, setTitle] = useState(video?.title ?? "");
  const [description, setDescription] = useState(video?.description ?? "");
  const [languageId, setLanguageId] = useState(video?.languageId ?? "");
  const [thumb, setThumb] = useState<{ blob: Blob; auto: boolean } | null>(null);
  const thumbUrl = useObjectUrl(thumb?.blob ?? null);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const tracker = useUploadTracker();
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage !== "idle";
  useWarnBeforeUnload(busy);

  function onPicked(v: PickedVideo) {
    setPicked(v);
    if (!title) setTitle(v.file.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ").trim());
    // A new file gets a fresh auto-thumbnail, unless the admin chose an image.
    if (!thumb || thumb.auto) {
      setThumb(v.frame ? { blob: v.frame, auto: true } : null);
      setRemoveThumb(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!video && !picked) return push("error", "Choose an MP4 file first.");
    if (!languageId) return push("error", "Choose a language.");
    if (title.trim().length < 2) return push("error", "Enter a title.");
    const controller = new AbortController();
    abortRef.current = controller;
    const uploaded: string[] = [];
    try {
      const body: DemoVideoEdit = {};
      if (picked) {
        setStage("video");
        tracker.reset();
        body.storageKey = await uploadToStore("video", picked.file, picked.file.name, "video/mp4", {
          purpose: "demo",
          onProgress: tracker.onProgress,
          signal: controller.signal,
        });
        uploaded.push(body.storageKey);
        body.durationSeconds = picked.durationSeconds;
      }
      if (thumb) {
        setStage("thumbnail");
        const type = thumb.blob.type || "image/jpeg";
        body.thumbnailKey = await uploadToStore("thumbnail", thumb.blob, `${title}.${type.split("/")[1]}`, type, {
          purpose: "demo",
          signal: controller.signal,
        });
        uploaded.push(body.thumbnailKey);
      } else if (removeThumb && video?.thumbnailUrl) {
        body.thumbnailKey = null;
      }
      setStage("saving");
      if (!video || title.trim() !== video.title) body.title = title.trim();
      if (!video || (description.trim() || null) !== video.description) body.description = description.trim() || null;
      if (!video || languageId !== video.languageId) body.languageId = languageId;

      const saved = video
        ? await videoService.updateDemo(video.id, body)
        : await videoService.createDemo({ ...body, title: body.title!, languageId, storageKey: body.storageKey! });
      onSaved(saved.video, !video);
    } catch (err) {
      await Promise.all(uploaded.map((k) => videoService.discardUpload(k).catch(() => {})));
      push("error", controller.signal.aborted ? "Upload cancelled." : errorText(err, "Saving failed. Please try again."));
      setStage("idle");
      tracker.reset();
    }
  }

  const stageLabel = stage === "video" ? "Uploading video…" : stage === "thumbnail" ? "Uploading thumbnail…" : "Saving…";

  return (
    <Modal title={video ? `Edit · ${video.language.name} demo` : "Upload demo video"} onClose={busy ? () => {} : onClose} size="xl">
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {video && <span className="label-field">Replace video file (optional)</span>}
          <VideoFilePicker
            picked={picked}
            onPicked={onPicked}
            disabled={busy}
            push={push}
            emptyLabel={
              video
                ? `Current file${video.sizeBytes !== null ? `: ${formatBytes(video.sizeBytes)}` : ""} · ${formatDuration(video.durationSeconds)}. Choose an MP4 to replace it.`
                : undefined
            }
          />
          {video && picked && !busy && (
            <button type="button" onClick={() => setPicked(null)} className="btn-ghost btn-sm">
              Keep the current file
            </button>
          )}
          <ThumbnailPicker
            preview={removeThumb ? null : thumbUrl ?? video?.thumbnailUrl ?? null}
            auto={!video}
            onPick={(f) => {
              const problem = checkThumbnail(f);
              if (problem) return push("error", problem);
              setThumb({ blob: f, auto: false });
              setRemoveThumb(false);
            }}
            onClear={() => {
              setThumb(null);
              setRemoveThumb(true);
            }}
          />
          {busy && <UploadProgressPanel label={stageLabel} progress={tracker.progress} speed={tracker.speed} determinate={stage === "video"} />}
        </div>

        <div className="space-y-4">
          <LanguageSelect languages={languages} value={languageId} onChange={setLanguageId} disabled={busy} />
          {languages.length === 0 && <p className="text-xs text-amber-600">Every language already has a demo — edit one to replace it.</p>}
          <label className="block">
            <span className="label-field">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className="input-field" disabled={busy} />
          </label>
          <label className="block">
            <span className="label-field">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={4} className="input-field" disabled={busy} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || (!video && !picked)} className="btn-gold flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : video ? <Pencil className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
              {video ? "Save changes" : "Upload demo"}
            </button>
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost" disabled={stage === "saving"}>
                <X className="h-4 w-4" /> Cancel
              </button>
            ) : (
              <button type="button" onClick={onClose} className="btn-ghost">
                Close
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

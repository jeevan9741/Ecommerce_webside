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

export interface DemoPlatformOption {
  id: string;
  name: string;
}

/** A demo's platform label; data from before platforms existed has none. */
function platformLabel(v: AdminDemoVideo) {
  return v.platform?.name ?? "No platform";
}

/**
 * Demo videos: one per platform and language, shown on the homepage before registration (no login).
 * Visitors pick a language and a platform in "Get Started" and see that demo, or its English one.
 */
export function DemoVideosPanel({
  languages,
  platforms,
  push,
}: {
  languages: AdminLanguage[];
  /** Homepage platforms (categories marked "Show on homepage"). */
  platforms: DemoPlatformOption[];
  push: Push;
}) {
  const [videos, setVideos] = useState<AdminDemoVideo[] | null>(null);
  const [platformFilter, setPlatformFilter] = useState("");
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

  const active = languages.filter((l) => l.isActive);
  // Per platform: which active languages have no demo (visitors get the English one, if it exists).
  const coverage = videos
    ? platforms.map((p) => {
        const own = videos.filter((v) => v.categoryId === p.id);
        return {
          platform: p,
          hasEnglish: own.some((v) => v.language.code === "en"),
          missing: active.filter((l) => !own.some((v) => v.languageId === l.id)),
        };
      })
    : [];
  const shown = videos?.filter((v) => !platformFilter || v.categoryId === platformFilter) ?? null;
  const unassigned = videos?.filter((v) => !v.platform) ?? [];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-parchment-muted">
          One demo per platform and language. Visitors pick a language, then a platform, and see that demo — or the
          platform&apos;s English demo if their language isn&apos;t ready yet. No login needed; the player streams only.
        </p>
        <button type="button" onClick={() => setDialog({ video: null })} className="btn-gold btn-sm self-start">
          <Plus className="h-4 w-4" /> Upload demo video
        </button>
      </div>

      {platforms.length === 0 && (
        <p className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No platform is shown on the homepage yet — turn on “Show on homepage” for a category in the Categories tab.
        </p>
      )}
      {unassigned.length > 0 && (
        <p className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {unassigned.length} demo video{unassigned.length === 1 ? " isn't" : "s aren't"} assigned to a platform, so visitors
          can&apos;t see {unassigned.length === 1 ? "it" : "them"}. Use Edit / Replace to choose a platform.
        </p>
      )}
      {coverage.some((c) => c.missing.length > 0) && (
        <div className="mt-4 space-y-1.5 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {coverage
            .filter((c) => c.missing.length > 0)
            .map((c) => (
              <p key={c.platform.id}>
                <span className="font-semibold">{c.platform.name}:</span>{" "}
                {c.missing.length === active.length
                  ? "no demo yet — visitors see “coming soon”."
                  : `${c.missing.length} language${c.missing.length === 1 ? "" : "s"} without a demo (${c.missing
                      .slice(0, 6)
                      .map((l) => l.name)
                      .join(", ")}${c.missing.length > 6 ? ", …" : ""})${c.hasEnglish ? " — visitors see the English demo." : " — no English fallback yet."}`}
              </p>
            ))}
        </div>
      )}

      {platforms.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {[{ id: "", name: "All platforms" }, ...platforms].map((p) => (
            <button
              key={p.id || "all"}
              type="button"
              onClick={() => setPlatformFilter(p.id)}
              aria-pressed={platformFilter === p.id}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                platformFilter === p.id ? "border-gold-500 bg-gold-500/10 text-parchment" : "border-border-soft text-parchment-muted hover:border-gold-500/50"
              }`}
            >
              {p.name}
              {p.id && videos ? ` · ${videos.filter((v) => v.categoryId === p.id).length}` : ""}
            </button>
          ))}
        </div>
      )}

      {error && <p className="card mt-5 p-5 text-sm text-danger">{error}</p>}
      {!videos && !error && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown?.map((v) => (
          <DemoCard
            key={v.id}
            video={v}
            onPreview={() => setPreviewing(v)}
            onEdit={() => setDialog({ video: v })}
            onDeleted={() => {
              load();
              push("success", `Deleted the ${platformLabel(v)} ${v.language.name} demo.`);
            }}
            push={push}
          />
        ))}
      </div>
      {shown?.length === 0 && (
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
          languages={languages}
          platforms={platforms}
          defaultPlatformId={platformFilter}
          // One demo per platform and language: the dialog hides pairs that are already taken.
          taken={videos.filter((v) => v.id !== dialog.video?.id).map((v) => `${v.categoryId}:${v.languageId}`)}
          onClose={() => setDialog(null)}
          onSaved={(v, created) => {
            setDialog(null);
            load();
            push("success", created ? `Uploaded the ${platformLabel(v)} ${v.language.name} demo.` : "Demo video updated.");
          }}
          push={push}
        />
      )}
      {previewing && (
        <Modal title={previewing.title || `${platformLabel(previewing)} · ${previewing.language.name} demo`} onClose={() => setPreviewing(null)} size="xl">
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
      <button type="button" onClick={onPreview} className="group relative" aria-label={`Preview ${platformLabel(v)} ${v.language.name} demo`}>
        <Thumb url={v.thumbnailUrl} className="w-full !rounded-none" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
          <Play className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100" />
        </span>
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white ${
            v.platform ? "bg-black/70" : "bg-danger"
          }`}
        >
          {platformLabel(v)} · {v.language.name}
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
  platforms,
  defaultPlatformId,
  taken,
  onClose,
  onSaved,
  push,
}: {
  video: AdminDemoVideo | null;
  languages: AdminLanguage[];
  platforms: DemoPlatformOption[];
  defaultPlatformId: string;
  /** "platformId:languageId" pairs that already have a demo. */
  taken: string[];
  onClose: () => void;
  onSaved: (v: AdminDemoVideo, created: boolean) => void;
  push: Push;
}) {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [title, setTitle] = useState(video?.title ?? "");
  const [description, setDescription] = useState(video?.description ?? "");
  // Editing keeps the demo's platform (none for pre-platform data: the admin must pick one); new
  // uploads start on the filtered platform, or the first.
  const [categoryId, setCategoryId] = useState(video ? (video.categoryId ?? "") : defaultPlatformId || platforms[0]?.id || "");
  const [languageId, setLanguageId] = useState(video?.languageId ?? "");
  const freeLanguages = languages.filter((l) => !taken.includes(`${categoryId}:${l.id}`));
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
    if (!categoryId) return push("error", "Choose a platform.");
    if (!languageId) return push("error", "Choose a language.");
    if (taken.includes(`${categoryId}:${languageId}`)) return push("error", "That platform already has a demo in this language.");
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
      if (!video || categoryId !== video.categoryId) body.categoryId = categoryId;

      const saved = video
        ? await videoService.updateDemo(video.id, body)
        : await videoService.createDemo({ ...body, title: body.title!, languageId, categoryId, storageKey: body.storageKey! });
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
          <label className="block">
            <span className="label-field">Platform</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                if (taken.includes(`${e.target.value}:${languageId}`)) setLanguageId("");
              }}
              className="input-field"
              disabled={busy}
            >
              <option value="" disabled>
                Choose a platform…
              </option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <LanguageSelect languages={freeLanguages} value={languageId} onChange={setLanguageId} disabled={busy} />
          {platforms.length === 0 && (
            <p className="text-xs text-amber-600">
              No homepage platform is set up yet — turn on &ldquo;Show on homepage&rdquo; for a category in the Categories tab first.
            </p>
          )}
          {video && !video.platform && (
            <p className="text-xs text-danger">This demo has no platform yet — choose one so visitors can see it.</p>
          )}
          {categoryId && freeLanguages.length === 0 && (
            <p className="text-xs text-amber-600">This platform has a demo in every language — edit one to replace it.</p>
          )}
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

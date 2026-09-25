"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Eye, EyeOff, Film, ImagePlus, Loader2, Pencil, Play, Plus, Search, Trash2, UploadCloud, X } from "lucide-react";
import { adminService } from "@/services/adminService";
import {
  MAX_VIDEO_BYTES,
  formatBytes,
  formatDuration,
  videoService,
  type AdminVideo,
  type VideoEdit,
} from "@/services/videoService";
import { readVideoFile, uploadToStore, type UploadProgress } from "@/lib/video-upload";
import { formatDate } from "@/lib/format";
import { Modal } from "@/components/admin/modal";
import { ToastStack, useToasts } from "@/components/toast";

interface CourseOption {
  id: string;
  title: string;
  isActive: boolean;
}

type Push = (type: "success" | "error", message: string) => void;

function errorText(err: unknown, fallback = "Something went wrong. Please try again.") {
  return err instanceof Error && err.message ? err.message : fallback;
}

const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function AdminVideosPage() {
  const [videos, setVideos] = useState<AdminVideo[] | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseFilter, setCourseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<AdminVideo | null>(null);
  const [previewing, setPreviewing] = useState<AdminVideo | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(async () => {
    try {
      const { videos } = await videoService.list({ courseId: courseFilter, q: search });
      setVideos(videos);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load videos."));
    }
  }, [courseFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    load();
  }, [load]);

  useEffect(() => {
    adminService
      .courses()
      .then(({ courses }) => setCourses(courses as CourseOption[]))
      .catch(() => setCourses([]));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Course Videos</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            Original course videos (MP4, up to 2 GB). Files are stored privately — only students who bought the
            assigned course can stream them, through short-lived signed links.
          </p>
        </div>
        <button type="button" onClick={() => setUploading(true)} className="btn-gold btn-sm">
          <Plus className="h-4 w-4" /> Upload video
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="input-field !py-2 sm:w-72">
          <option value="">All courses</option>
          <option value="unassigned">Not assigned to a course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
          className="flex gap-2"
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" className="input-field !py-2 sm:w-64" />
          <button type="submit" className="btn-outline btn-sm" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </form>
      </div>

      <div className="mt-5 space-y-3">
        {error && <p className="card p-5 text-sm text-danger">{error}</p>}
        {!videos && !error && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        )}
        {videos?.map((v) => (
          <VideoRow
            key={v.id}
            video={v}
            onEdit={() => setEditing(v)}
            onPreview={() => setPreviewing(v)}
            onDeleted={() => {
              load();
              push("success", `Deleted “${v.title}”.`);
            }}
            push={push}
          />
        ))}
        {videos?.length === 0 && (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <Film className="h-10 w-10 text-gold-500" />
            <p className="text-sm text-parchment-muted">No videos here yet.</p>
            <button type="button" onClick={() => setUploading(true)} className="btn-outline btn-sm">
              <UploadCloud className="h-4 w-4" /> Upload the first one
            </button>
          </div>
        )}
      </div>

      {uploading && (
        <UploadDialog
          courses={courses}
          defaultCourseId={courseFilter && courseFilter !== "unassigned" ? courseFilter : ""}
          onClose={() => setUploading(false)}
          onCreated={(v) => {
            setUploading(false);
            load();
            push("success", `Uploaded “${v.title}”.`);
          }}
          push={push}
        />
      )}
      {editing && (
        <EditDialog
          video={editing}
          courses={courses}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            push("success", "Video updated.");
          }}
          push={push}
        />
      )}
      {previewing && <PreviewDialog video={previewing} onClose={() => setPreviewing(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Thumb({ url, className = "" }: { url: string | null; className?: string }) {
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

function VideoRow({
  video: v,
  onEdit,
  onPreview,
  onDeleted,
  push,
}: {
  video: AdminVideo;
  onEdit: () => void;
  onPreview: () => void;
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
      await videoService.remove(v.id);
      onDeleted();
    } catch (err) {
      push("error", errorText(err));
      setDeleting(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <button type="button" onClick={onPreview} className="group relative w-full sm:w-44" aria-label={`Preview ${v.title}`}>
        <Thumb url={v.thumbnailUrl} className="w-full" />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition group-hover:bg-black/30">
          <Play className="h-8 w-8 text-white opacity-0 transition group-hover:opacity-100" />
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {formatDuration(v.durationSeconds)}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-parchment">{v.title}</p>
          {!v.isPublished && (
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Hidden
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-parchment-muted">
          {v.courseTitle ? (
            <>
              {v.courseTitle} · position {v.displayOrder + 1}
            </>
          ) : (
            <span className="font-semibold text-amber-600">Not assigned to a course — students can&apos;t see it</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-parchment-muted">
          {formatBytes(v.sizeBytes)} · uploaded {formatDate(v.createdAt)} · {v.viewers} watching · {v.completions} completed
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onEdit} className="btn-outline btn-sm">
          <Pencil className="h-4 w-4" /> Edit
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="btn-outline btn-sm !border-danger !text-danger hover:!bg-danger hover:!text-white"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {confirming ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function CourseSelect({ courses, value, onChange }: { courses: CourseOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label-field">Assign to course</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        <option value="">Not assigned (hidden from students)</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
            {c.isActive ? "" : " (inactive)"}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- thumbnail picker (shared) ----------

function ThumbnailPicker({
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

function checkThumbnail(file: File) {
  if (!THUMBNAIL_TYPES.includes(file.type)) return "Thumbnails must be JPG, PNG or WebP.";
  if (file.size > 5 * 1024 ** 2) return "Thumbnails can be at most 5 MB.";
  return null;
}

// ---------- upload ----------

function UploadDialog({
  courses,
  defaultCourseId,
  onClose,
  onCreated,
  push,
}: {
  courses: CourseOption[];
  defaultCourseId: string;
  onClose: () => void;
  onCreated: (v: AdminVideo) => void;
  push: Push;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId);
  const [published, setPublished] = useState(true);
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [thumbIsAuto, setThumbIsAuto] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "video" | "thumbnail" | "saving">("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sample = useRef<{ t: number; loaded: number } | null>(null);
  const busy = stage !== "idle";

  // Warn before closing the tab mid-upload — a 2 GB upload can't resume after a reload.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => () => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  }, [thumbUrl]);

  function setThumbBlob(b: Blob | null, auto: boolean) {
    setThumb(b);
    setThumbIsAuto(auto);
    setThumbUrl(b ? URL.createObjectURL(b) : null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type !== "video/mp4" && !/\.mp4$/i.test(f.name)) return push("error", "Only MP4 videos can be uploaded.");
    if (f.size > MAX_VIDEO_BYTES) return push("error", `That file is ${formatBytes(f.size)} — the limit is 2 GB.`);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ").trim());
    try {
      const meta = await readVideoFile(f);
      setDuration(meta.durationSeconds);
      if (!thumb || thumbIsAuto) setThumbBlob(await meta.captureFrame(), true);
      meta.release();
    } catch (err) {
      setDuration(null);
      push("error", `${errorText(err)} You can still upload it.`);
    }
  }

  function trackProgress(p: UploadProgress) {
    setProgress(p);
    const now = performance.now();
    const last = sample.current;
    if (!last) sample.current = { t: now, loaded: p.loaded };
    else if (now - last.t > 1500) {
      setSpeed(((p.loaded - last.loaded) / (now - last.t)) * 1000);
      sample.current = { t: now, loaded: p.loaded };
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return push("error", "Choose an MP4 file first.");
    if (title.trim().length < 2) return push("error", "Enter a title.");
    const controller = new AbortController();
    abortRef.current = controller;
    let videoKey: string | null = null;
    let thumbKey: string | null = null;
    try {
      setStage("video");
      sample.current = null;
      videoKey = await uploadToStore("video", file, file.name, "video/mp4", { onProgress: trackProgress, signal: controller.signal });
      if (thumb) {
        setStage("thumbnail");
        const type = thumb.type || "image/jpeg";
        thumbKey = await uploadToStore("thumbnail", thumb, `${title}.${type.split("/")[1]}`, type, { signal: controller.signal });
      }
      setStage("saving");
      const { video } = await videoService.create({
        title: title.trim(),
        description: description.trim() || null,
        courseId: courseId || null,
        storageKey: videoKey,
        thumbnailKey: thumbKey,
        durationSeconds: duration,
        isPublished: published,
      });
      onCreated(video);
    } catch (err) {
      // Don't leave orphaned files behind when the record never got saved.
      await Promise.all([videoKey, thumbKey].filter(Boolean).map((k) => videoService.discardUpload(k!).catch(() => {})));
      push("error", controller.signal.aborted ? "Upload cancelled." : errorText(err, "Upload failed. Please try again."));
      setStage("idle");
      setProgress(null);
    }
  }

  const eta = progress && speed && speed > 0 ? (progress.total - progress.loaded) / speed : null;

  return (
    <Modal title="Upload course video" onClose={busy ? () => {} : onClose} size="xl">
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className={`input-field flex cursor-pointer flex-col items-center justify-center gap-2 !py-8 text-center ${busy ? "pointer-events-none opacity-60" : "hover:border-gold-500"}`}>
            <UploadCloud className="h-6 w-6 text-gold-500" />
            {file ? (
              <span className="text-sm text-parchment">
                <span className="font-semibold">{file.name}</span>
                <span className="block text-xs text-parchment-muted">
                  {formatBytes(file.size)} · {formatDuration(duration)}
                </span>
              </span>
            ) : (
              <span className="text-sm text-parchment-muted">Choose an MP4 file (up to 2 GB)</span>
            )}
            <input type="file" accept="video/mp4,.mp4" className="hidden" onChange={onFile} disabled={busy} />
          </label>

          <ThumbnailPicker
            preview={thumbUrl}
            auto
            onPick={(f) => {
              const problem = checkThumbnail(f);
              if (problem) push("error", problem);
              else setThumbBlob(f, false);
            }}
            onClear={() => setThumbBlob(null, false)}
          />

          {busy && (
            <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-parchment">
                <span>
                  {stage === "video" ? "Uploading video…" : stage === "thumbnail" ? "Uploading thumbnail…" : "Saving…"}
                </span>
                {stage === "video" && progress && <span>{Math.floor(progress.percentage)}%</span>}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-soft">
                <div
                  className="h-full rounded-full bg-gold-500 transition-all"
                  style={{ width: `${stage === "video" ? progress?.percentage ?? 0 : 100}%` }}
                />
              </div>
              {stage === "video" && progress && (
                <p className="mt-2 text-xs text-parchment-muted">
                  {formatBytes(progress.loaded)} of {formatBytes(progress.total)}
                  {speed ? ` · ${formatBytes(speed)}/s` : ""}
                  {eta !== null ? ` · about ${formatDuration(eta)} left` : ""}
                </p>
              )}
              <p className="mt-1 text-xs text-parchment-muted">Keep this tab open until the upload finishes.</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="label-field">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className="input-field" disabled={busy} />
          </label>
          <label className="block">
            <span className="label-field">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={4} className="input-field" disabled={busy} />
          </label>
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
          <label className="flex items-center gap-2 text-sm text-parchment">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} disabled={busy} />
            Visible to students of the course
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !file} className="btn-gold flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Upload video
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

// ---------- edit ----------

function EditDialog({
  video,
  courses,
  onClose,
  onSaved,
  push,
}: {
  video: AdminVideo;
  courses: CourseOption[];
  onClose: () => void;
  onSaved: () => void;
  push: Push;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [courseId, setCourseId] = useState(video.courseId ?? "");
  const [published, setPublished] = useState(video.isPublished);
  const [order, setOrder] = useState(String(video.displayOrder + 1));
  const [newThumb, setNewThumb] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(video.thumbnailUrl);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return push("error", "Enter a title.");
    const position = Number(order);
    if (!Number.isInteger(position) || position < 1) return push("error", "Position must be a whole number from 1.");
    setSaving(true);
    let uploaded: string | null = null;
    try {
      const body: VideoEdit = {};
      if (title.trim() !== video.title) body.title = title.trim();
      if ((description.trim() || null) !== video.description) body.description = description.trim() || null;
      if ((courseId || null) !== video.courseId) body.courseId = courseId || null;
      if (published !== video.isPublished) body.isPublished = published;
      if (position - 1 !== video.displayOrder) body.displayOrder = position - 1;
      if (newThumb) {
        uploaded = await uploadToStore("thumbnail", newThumb, newThumb.name, newThumb.type);
        body.thumbnailKey = uploaded;
      } else if (removeThumb && video.hasThumbnail) {
        body.thumbnailKey = null;
      }
      if (Object.keys(body).length > 0) await videoService.update(video.id, body);
      onSaved();
    } catch (err) {
      if (uploaded) await videoService.discardUpload(uploaded).catch(() => {});
      push("error", errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Edit · ${video.title}`} onClose={saving ? () => {} : onClose}>
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="label-field">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className="input-field" />
        </label>
        <label className="block">
          <span className="label-field">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} className="input-field" />
        </label>
        <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
        <label className="block">
          <span className="label-field">Position in course</span>
          <input type="number" min={1} step={1} value={order} onChange={(e) => setOrder(e.target.value)} className="input-field sm:w-32" />
        </label>
        <ThumbnailPicker
          preview={removeThumb ? null : thumbPreview}
          onPick={(f) => {
            const problem = checkThumbnail(f);
            if (problem) return push("error", problem);
            setNewThumb(f);
            setRemoveThumb(false);
            setThumbPreview(URL.createObjectURL(f));
          }}
          onClear={() => {
            setNewThumb(null);
            setRemoveThumb(true);
          }}
        />
        <label className="flex items-center gap-2 text-sm text-parchment">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          {published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Visible to students of the course
        </label>
        <button type="submit" disabled={saving} className="btn-gold btn-block">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save changes
        </button>
      </form>
    </Modal>
  );
}

// ---------- preview ----------

function PreviewDialog({ video, onClose }: { video: AdminVideo; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    videoService
      .preview(video.id)
      .then((r) => setUrl(r.streamUrl))
      .catch((err) => setError(errorText(err, "Could not load the video.")));
  }, [video.id]);

  return (
    <Modal title={video.title} onClose={onClose} size="xl">
      {error && <p className="text-sm text-danger">{error}</p>}
      {!url && !error && (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      )}
      {url && (
        <video
          src={url}
          poster={video.thumbnailUrl ?? undefined}
          controls
          autoPlay
          controlsList="nodownload"
          className="aspect-video w-full rounded-xl bg-black"
        />
      )}
    </Modal>
  );
}

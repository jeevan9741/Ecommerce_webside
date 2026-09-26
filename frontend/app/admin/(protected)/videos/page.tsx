"use client";

import { use, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Film, Loader2, Pencil, Play, Plus, Search, Trash2, UploadCloud, X } from "lucide-react";
import { adminService } from "@/services/adminService";
import { formatBytes, formatDuration, videoService, type AdminVideo, type VideoEdit } from "@/services/videoService";
import { uploadToStore } from "@/lib/video-upload";
import { formatDate } from "@/lib/format";
import { Modal } from "@/components/admin/modal";
import { ToastStack, useToasts } from "@/components/toast";
import { DemoVideosPanel } from "@/components/admin/demo-videos-panel";
import { CategoryManager } from "@/components/admin/category-manager";
import { categoryService, type AdminCategory, type PackageOption } from "@/services/categoryService";
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

interface CourseOption {
  id: string;
  title: string;
  isActive: boolean;
}

type Tab = "course" | "categories" | "demo";
const TABS: [Tab, string][] = [
  ["course", "Course videos"],
  ["categories", "Categories"],
  ["demo", "Demo videos"],
];

export default function AdminVideosPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const requested = use(searchParams).tab;
  const initialTab: Tab = requested === "demo" || requested === "categories" ? requested : "course";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [languages, setLanguages] = useState<AdminLanguage[]>([]);
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const { toasts, push, dismiss } = useToasts();

  const reloadCategories = useCallback(async () => {
    try {
      const data = await categoryService.adminList();
      setCategories(data.categories);
      setPackages(data.packages);
    } catch (err) {
      push("error", errorText(err, "Could not load categories."));
      setCategories((c) => c ?? []);
    }
  }, [push]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void reloadCategories();
  }, [reloadCategories]);

  useEffect(() => {
    adminService
      .courses()
      .then(({ courses }) => setCourses(courses as CourseOption[]))
      .catch(() => setCourses([]));
    adminService
      .languages()
      .then(({ languages }) => setLanguages(languages as AdminLanguage[]))
      .catch(() => setLanguages([]));
  }, []);

  function switchTab(next: Tab) {
    setTab(next);
    // Keep the tab in the URL so reloads and links land on it.
    window.history.replaceState(null, "", next === "course" ? window.location.pathname : `?tab=${next}`);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Video Management</h1>
      <p className="mt-1 text-sm text-parchment-muted">
        Course videos are private and filed into categories — buyers of a package that unlocks the category stream them
        through short-lived signed links. Demo videos are free to watch on the homepage without logging in.
      </p>

      <div role="tablist" className="mt-5 inline-flex rounded-xl border border-border-soft p-1">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === id ? "bg-gold-500 text-white" : "text-parchment-muted hover:text-parchment"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "course" && (
          <CourseVideosPanel courses={courses} languages={languages} categories={categories ?? []} onChanged={reloadCategories} push={push} />
        )}
        {tab === "categories" && <CategoryManager categories={categories} packages={packages} reload={reloadCategories} push={push} />}
        {tab === "demo" && <DemoVideosPanel languages={languages} push={push} />}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ---------- course videos ----------

/** Leaf categories (subcategories, or categories without any) — where videos can be filed. */
function leafOptions(categories: AdminCategory[]) {
  return categories.map((c) => ({
    group: c.name,
    options: c.subcategories.length ? c.subcategories.map((s) => ({ id: s.id, label: s.name })) : [{ id: c.id, label: c.name }],
  }));
}

function isLeaf(categories: AdminCategory[], id: string) {
  return leafOptions(categories).some((g) => g.options.some((o) => o.id === id));
}

function CourseVideosPanel({
  courses,
  languages,
  categories,
  onChanged,
  push,
}: {
  courses: CourseOption[];
  languages: AdminLanguage[];
  categories: AdminCategory[];
  /** Refreshes category counts after a video is added, moved or deleted. */
  onChanged: () => Promise<void>;
  push: Push;
}) {
  const [videos, setVideos] = useState<AdminVideo[] | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<AdminVideo | null>(null);
  const [previewing, setPreviewing] = useState<AdminVideo | null>(null);

  const load = useCallback(async () => {
    try {
      const { videos } = await videoService.list({ categoryId: categoryFilter, courseId: courseFilter, q: search });
      setVideos(videos);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load videos."));
    }
  }, [categoryFilter, courseFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    load();
  }, [load]);

  const refresh = () => {
    void load();
    void onChanged();
  };
  // A new filter shows the spinner rather than the previous filter's results while it loads.
  const filterCategory = (id: string) => {
    if (id !== categoryFilter) setVideos(null);
    setCategoryFilter(id);
  };
  const selectedName =
    categoryFilter === "uncategorized"
      ? "Not in a category"
      : categoryFilter
        ? categories.flatMap((c) => [c, ...c.subcategories]).find((c) => c.id === categoryFilter)?.name ?? null
        : null;
  const uploadTarget = categoryFilter && isLeaf(categories, categoryFilter) ? selectedName : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <CategorySidebar categories={categories} value={categoryFilter} onChange={filterCategory} />

      <div className="min-w-0">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={courseFilter}
              onChange={(e) => {
                setVideos(null);
                setCourseFilter(e.target.value);
              }}
              className="input-field !py-2 sm:w-60"
            >
              <option value="">Any package</option>
              <option value="unassigned">No direct package</option>
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" className="input-field !py-2 sm:w-56" />
              <button type="submit" className="btn-outline btn-sm" aria-label="Search">
                <Search className="h-4 w-4" />
              </button>
            </form>
          </div>
          <button type="button" onClick={() => setUploading(true)} className="btn-gold btn-sm self-start">
            <Plus className="h-4 w-4" /> {uploadTarget ? `Upload to ${uploadTarget}` : "Upload course video"}
          </button>
        </div>

        {selectedName && (
          <p className="mt-4 text-sm font-semibold text-parchment">
            {selectedName}
            {videos && (
              <span className="font-normal text-parchment-muted">
                {" "}
                · {videos.length} {videos.length === 1 ? "video" : "videos"}
              </span>
            )}
          </p>
        )}

        <div className="mt-4 space-y-3">
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
                refresh();
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
      </div>

      {uploading && (
        <UploadDialog
          courses={courses}
          languages={languages}
          categories={categories}
          defaultCourseId={courseFilter && courseFilter !== "unassigned" ? courseFilter : ""}
          defaultCategoryId={categoryFilter && isLeaf(categories, categoryFilter) ? categoryFilter : ""}
          onClose={() => setUploading(false)}
          onCreated={(v) => {
            setUploading(false);
            refresh();
            push("success", `Uploaded “${v.title}”.`);
          }}
          push={push}
        />
      )}
      {editing && (
        <EditDialog
          video={editing}
          courses={courses}
          languages={languages}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
            push("success", "Video updated.");
          }}
          push={push}
        />
      )}
      {previewing && <PreviewDialog video={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

/** Category tree with video counts; a dropdown on small screens. */
function CategorySidebar({ categories, value, onChange }: { categories: AdminCategory[]; value: string; onChange: (id: string) => void }) {
  const item = (id: string, label: string, count: number | null, indent = false) => (
    <button
      key={id || "all"}
      type="button"
      onClick={() => onChange(id)}
      aria-current={value === id}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${indent ? "pl-7" : "font-semibold"} ${
        value === id ? "bg-gold-500/10 text-parchment" : "text-parchment-muted hover:bg-surface-hover hover:text-parchment"
      }`}
    >
      <span className="truncate">{label}</span>
      {count !== null && <span className="shrink-0 text-xs text-parchment-muted">{count}</span>}
    </button>
  );

  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field !py-2 lg:hidden" aria-label="Category">
        <option value="">All videos</option>
        <option value="uncategorized">Not in a category</option>
        {categories.map((c) =>
          c.subcategories.length ? (
            <optgroup key={c.id} label={c.name}>
              <option value={c.id}>All {c.name}</option>
              {c.subcategories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.videoCount})
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={c.id} value={c.id}>
              {c.name} ({c.videoCount})
            </option>
          )
        )}
      </select>
      <nav className="card hidden h-fit p-2 lg:block" aria-label="Categories">
        {item("", "All videos", null)}
        {item("uncategorized", "Not in a category", null)}
        <div className="my-2 border-t border-border-soft" />
        {categories.map((c) => (
          <div key={c.id}>
            {item(c.id, c.name, c.videoCount)}
            {c.subcategories.map((s) => item(s.id, s.name.replace(`${c.name} `, ""), s.videoCount, true))}
          </div>
        ))}
      </nav>
    </>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
  disabled,
}: {
  categories: AdminCategory[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="label-field">Category</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field" disabled={disabled}>
        <option value="">Not in a category</option>
        {leafOptions(categories).map((g) =>
          g.options.length === 1 && g.options[0].label === g.group ? (
            <option key={g.options[0].id} value={g.options[0].id}>
              {g.group}
            </option>
          ) : (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>
      <span className="mt-1 block text-xs text-parchment-muted">Buyers of any package that unlocks the category can watch it.</span>
    </label>
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
          {v.language && (
            <span className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gold-600">
              {v.language.name}
            </span>
          )}
          {!v.isPublished && (
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Hidden
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-parchment-muted">
          {v.category || v.courseTitle ? (
            <>
              {v.category && (v.category.parentName ? `${v.category.parentName} › ${v.category.name}` : v.category.name)}
              {v.category && v.courseTitle && " · "}
              {v.courseTitle && `Package: ${v.courseTitle}`} · position {v.displayOrder + 1}
            </>
          ) : (
            <span className="font-semibold text-amber-600">Not in a category or package — students can&apos;t see it</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-parchment-muted">
          {formatBytes(v.sizeBytes)} · uploaded {formatDate(v.createdAt)} · {v.viewers} watching · {v.completions} completed
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onEdit} className="btn-outline btn-sm flex-1 sm:flex-none">
          <Pencil className="h-4 w-4" /> Edit
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="btn-outline btn-sm flex-1 !border-danger !text-danger hover:!bg-danger hover:!text-white sm:flex-none"
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
      <span className="label-field">Direct package access (optional)</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        <option value="">None — access comes from the category</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
            {c.isActive ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-parchment-muted">Also shows the video on that package&apos;s course page.</span>
    </label>
  );
}

// ---------- upload ----------

type Stage = "idle" | "video" | "thumbnail" | "saving";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  video: "Uploading video…",
  thumbnail: "Uploading thumbnail…",
  saving: "Saving…",
};

function UploadDialog({
  courses,
  languages,
  categories,
  defaultCourseId,
  defaultCategoryId,
  onClose,
  onCreated,
  push,
}: {
  courses: CourseOption[];
  languages: AdminLanguage[];
  categories: AdminCategory[];
  defaultCourseId: string;
  defaultCategoryId: string;
  onClose: () => void;
  onCreated: (v: AdminVideo) => void;
  push: Push;
}) {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId);
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [languageId, setLanguageId] = useState("");
  const [published, setPublished] = useState(true);
  const [thumb, setThumb] = useState<{ blob: Blob; auto: boolean } | null>(null);
  const thumbUrl = useObjectUrl(thumb?.blob ?? null);
  const [stage, setStage] = useState<Stage>("idle");
  const tracker = useUploadTracker();
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage !== "idle";
  useWarnBeforeUnload(busy);

  function onPicked(v: PickedVideo) {
    setPicked(v);
    if (!title) setTitle(v.file.name.replace(/\.mp4$/i, "").replace(/[_-]+/g, " ").trim());
    if (!thumb || thumb.auto) setThumb(v.frame ? { blob: v.frame, auto: true } : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return push("error", "Choose an MP4 file first.");
    if (title.trim().length < 2) return push("error", "Enter a title.");
    const controller = new AbortController();
    abortRef.current = controller;
    let videoKey: string | null = null;
    let thumbKey: string | null = null;
    try {
      setStage("video");
      tracker.reset();
      videoKey = await uploadToStore("video", picked.file, picked.file.name, "video/mp4", {
        onProgress: tracker.onProgress,
        signal: controller.signal,
      });
      if (thumb) {
        setStage("thumbnail");
        const type = thumb.blob.type || "image/jpeg";
        thumbKey = await uploadToStore("thumbnail", thumb.blob, `${title}.${type.split("/")[1]}`, type, { signal: controller.signal });
      }
      setStage("saving");
      const { video } = await videoService.create({
        title: title.trim(),
        description: description.trim() || null,
        courseId: courseId || null,
        categoryId: categoryId || null,
        languageId: languageId || null,
        storageKey: videoKey,
        thumbnailKey: thumbKey,
        durationSeconds: picked.durationSeconds,
        isPublished: published,
      });
      onCreated(video);
    } catch (err) {
      // Don't leave orphaned files behind when the record never got saved.
      await Promise.all([videoKey, thumbKey].filter(Boolean).map((k) => videoService.discardUpload(k!).catch(() => {})));
      push("error", controller.signal.aborted ? "Upload cancelled." : errorText(err, "Upload failed. Please try again."));
      setStage("idle");
      tracker.reset();
    }
  }

  return (
    <Modal title="Upload course video" onClose={busy ? () => {} : onClose} size="xl">
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <VideoFilePicker picked={picked} onPicked={onPicked} disabled={busy} push={push} />
          <ThumbnailPicker
            preview={thumbUrl}
            auto
            onPick={(f) => {
              const problem = checkThumbnail(f);
              if (problem) push("error", problem);
              else setThumb({ blob: f, auto: false });
            }}
            onClear={() => setThumb(null)}
          />
          {busy && (
            <UploadProgressPanel label={STAGE_LABEL[stage as Exclude<Stage, "idle">]} progress={tracker.progress} speed={tracker.speed} determinate={stage === "video"} />
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
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} disabled={busy} />
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
          <LanguageSelect languages={languages} value={languageId} onChange={setLanguageId} emptyLabel="Not specified" disabled={busy} />
          <label className="flex items-center gap-2 text-sm text-parchment">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} disabled={busy} />
            Published (visible to students with access)
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !picked} className="btn-gold flex-1">
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

// ---------- edit (incl. replacing the file) ----------

function EditDialog({
  video,
  courses,
  languages,
  categories,
  onClose,
  onSaved,
  push,
}: {
  video: AdminVideo;
  courses: CourseOption[];
  languages: AdminLanguage[];
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: () => void;
  push: Push;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [courseId, setCourseId] = useState(video.courseId ?? "");
  const [categoryId, setCategoryId] = useState(video.categoryId ?? "");
  const [languageId, setLanguageId] = useState(video.languageId ?? "");
  const [published, setPublished] = useState(video.isPublished);
  const [order, setOrder] = useState(String(video.displayOrder + 1));
  const [replacement, setReplacement] = useState<PickedVideo | null>(null);
  const [newThumb, setNewThumb] = useState<File | null>(null);
  const newThumbUrl = useObjectUrl(newThumb);
  const [removeThumb, setRemoveThumb] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const tracker = useUploadTracker();
  const abortRef = useRef<AbortController | null>(null);
  const busy = stage !== "idle";
  useWarnBeforeUnload(busy);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return push("error", "Enter a title.");
    const position = Number(order);
    if (!Number.isInteger(position) || position < 1) return push("error", "Position must be a whole number from 1.");
    const controller = new AbortController();
    abortRef.current = controller;
    const uploaded: string[] = [];
    try {
      const body: VideoEdit = {};
      if (title.trim() !== video.title) body.title = title.trim();
      if ((description.trim() || null) !== video.description) body.description = description.trim() || null;
      if ((courseId || null) !== video.courseId) body.courseId = courseId || null;
      if ((categoryId || null) !== video.categoryId) body.categoryId = categoryId || null;
      if ((languageId || null) !== video.languageId) body.languageId = languageId || null;
      if (published !== video.isPublished) body.isPublished = published;
      if (position - 1 !== video.displayOrder) body.displayOrder = position - 1;
      if (replacement) {
        setStage("video");
        tracker.reset();
        body.storageKey = await uploadToStore("video", replacement.file, replacement.file.name, "video/mp4", {
          onProgress: tracker.onProgress,
          signal: controller.signal,
        });
        uploaded.push(body.storageKey);
        body.durationSeconds = replacement.durationSeconds;
      }
      if (newThumb) {
        setStage("thumbnail");
        body.thumbnailKey = await uploadToStore("thumbnail", newThumb, newThumb.name, newThumb.type, { signal: controller.signal });
        uploaded.push(body.thumbnailKey);
      } else if (removeThumb && video.hasThumbnail) {
        body.thumbnailKey = null;
      }
      setStage("saving");
      if (Object.keys(body).length > 0) await videoService.update(video.id, body);
      onSaved();
    } catch (err) {
      await Promise.all(uploaded.map((k) => videoService.discardUpload(k).catch(() => {})));
      push("error", controller.signal.aborted ? "Upload cancelled." : errorText(err));
      setStage("idle");
      tracker.reset();
    }
  }

  return (
    <Modal title={`Edit · ${video.title}`} onClose={busy ? () => {} : onClose} size="xl">
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="label-field">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className="input-field" disabled={busy} />
          </label>
          <label className="block">
            <span className="label-field">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} className="input-field" disabled={busy} />
          </label>
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} disabled={busy} />
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
          <LanguageSelect languages={languages} value={languageId} onChange={setLanguageId} emptyLabel="Not specified" disabled={busy} />
          <label className="block">
            <span className="label-field">Position</span>
            <input type="number" min={1} step={1} value={order} onChange={(e) => setOrder(e.target.value)} className="input-field sm:w-32" disabled={busy} />
          </label>
          <label className="flex items-center gap-2 text-sm text-parchment">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} disabled={busy} />
            {published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Published (visible to students with access)
          </label>
        </div>

        <div className="space-y-4">
          <div>
            <span className="label-field">Replace video file (optional)</span>
            <VideoFilePicker
              picked={replacement}
              onPicked={setReplacement}
              disabled={busy}
              push={push}
              emptyLabel={`Current file: ${formatBytes(video.sizeBytes)} · ${formatDuration(video.durationSeconds)}. Choose an MP4 to replace it.`}
            />
            {replacement && !busy && (
              <button type="button" onClick={() => setReplacement(null)} className="btn-ghost btn-sm mt-1">
                Keep the current file
              </button>
            )}
            <p className="mt-1 text-xs text-parchment-muted">Students keep their watch progress when the file is replaced.</p>
          </div>
          <ThumbnailPicker
            preview={removeThumb ? null : newThumbUrl ?? video.thumbnailUrl}
            onPick={(f) => {
              const problem = checkThumbnail(f);
              if (problem) return push("error", problem);
              setNewThumb(f);
              setRemoveThumb(false);
            }}
            onClear={() => {
              setNewThumb(null);
              setRemoveThumb(true);
            }}
          />
          {busy && (
            <UploadProgressPanel label={STAGE_LABEL[stage as Exclude<Stage, "idle">]} progress={tracker.progress} speed={tracker.speed} determinate={stage === "video"} />
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-gold flex-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save changes
            </button>
            {busy && (
              <button type="button" onClick={() => abortRef.current?.abort()} className="btn-ghost" disabled={stage === "saving"}>
                <X className="h-4 w-4" /> Cancel
              </button>
            )}
          </div>
        </div>
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
      {url && <StreamOnlyVideo src={url} poster={video.thumbnailUrl ?? undefined} autoPlay playsInline className="aspect-video w-full rounded-xl bg-black" />}
    </Modal>
  );
}

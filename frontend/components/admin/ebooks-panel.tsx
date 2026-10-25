"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { put } from "@vercel/blob/client";
import { Download, Eye, EyeOff, FileText, Loader2, Pencil, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Modal } from "@/components/admin/modal";
import { LanguageSelect, UploadProgressPanel, errorText, useWarnBeforeUnload, type AdminLanguage, type Push } from "@/components/admin/video-shared";
import type { UploadProgress } from "@/lib/video-upload";
import { formatDate, formatInr } from "@/lib/format";
import { formatBytes } from "@/services/videoService";
import type { AdminCategory } from "@/services/categoryService";
import { MAX_EBOOK_BYTES, learningService, openAfter, type AdminEBook } from "@/services/learningService";

export interface PackageOption {
  id: string;
  title: string;
  isActive: boolean;
  type?: string;
  priceInPaise?: number;
}

/** Content type from the extension — browsers often report "" for EPUB. */
const TYPE_BY_EXT: Record<string, string> = { pdf: "application/pdf", epub: "application/epub+zip" };

function checkEBookFile(file: File): { contentType: string } | { error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = TYPE_BY_EXT[ext];
  if (!contentType) return { error: "Only PDF or EPUB files can be uploaded." };
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX_EBOOK_BYTES) return { error: "E-books can be at most 100 MB." };
  return { contentType };
}

/** Browser → private Blob store with a token scoped to one path, type and size; returns the storage key. */
async function uploadEBookFile(file: File, contentType: string, onProgress: (p: UploadProgress) => void) {
  const { pathname, clientToken } = await learningService.ebookUploadToken({ filename: file.name, contentType, sizeBytes: file.size });
  await put(pathname, file, { access: "private", token: clientToken, contentType, multipart: file.size > 20 * 1024 ** 2, onUploadProgress: onProgress });
  return pathname;
}

const packageLabel = (p: PackageOption) => `${p.title}${p.priceInPaise !== undefined ? ` — ${formatInr(p.priceInPaise)}` : ""}${p.isActive ? "" : " (inactive)"}`;

export function EBooksPanel({
  courses,
  categories,
  languages,
  push,
}: {
  courses: PackageOption[];
  categories: AdminCategory[];
  languages: AdminLanguage[];
  push: Push;
}) {
  const [ebooks, setEbooks] = useState<AdminEBook[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminEBook | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Only the latest request may update the list (a slow response for an old filter is dropped).
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const { ebooks } = await learningService.adminEBooks(filter || undefined);
      if (request !== latest.current) return;
      setEbooks(ebooks);
      setError(null);
    } catch (err) {
      if (request === latest.current) setError(errorText(err, "Could not load e-books."));
    }
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-filter-change
    void load();
  }, [load]);

  async function togglePublished(e: AdminEBook) {
    setBusyId(e.id);
    try {
      await learningService.updateEBook(e.id, { isPublished: !e.isPublished });
      push("success", e.isPublished ? "E-book hidden from students." : "E-book published.");
      await load();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(e: AdminEBook) {
    setBusyId(e.id);
    try {
      await learningService.removeEBook(e.id);
      push("success", `“${e.title}” removed.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function preview(e: AdminEBook) {
    try {
      await openAfter(async () => (await learningService.downloadEBook(e.id)).url);
    } catch (err) {
      push("error", errorText(err, "Could not open the file."));
    }
  }

  const defaultCourse = courses.find((c) => c.type === "EBOOK" && c.isActive)?.id ?? courses[0]?.id ?? "";

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl text-sm text-parchment-muted">
          PDF or EPUB, up to 100 MB. Files are stored privately — only customers with a <strong>paid</strong> order for the e-book&apos;s package can
          download them, through links that expire after 5 minutes. Refunded or cancelled orders lose access automatically.
        </div>
        <button type="button" className="btn-gold btn-sm shrink-0" onClick={() => setEditing("new")} disabled={courses.length === 0}>
          <Plus className="h-4 w-4" /> Upload e-book
        </button>
      </div>

      <div className="mt-4 max-w-sm">
        <label className="label-field" htmlFor="ebook-filter">
          Package
        </label>
        <select id="ebook-filter" className="input-field" value={filter} onChange={(e) => { setEbooks(null); setFilter(e.target.value); }}>
          <option value="">All packages</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {packageLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="card p-5 text-sm text-danger">{error}</p>
        ) : !ebooks ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        ) : ebooks.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <FileText className="h-10 w-10 text-gold-500" />
            <p className="text-sm text-parchment-muted">No e-books yet. Upload the first one for the E-Books package.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {ebooks.map((e) => (
              <li key={e.id} className="card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
                  <div className="min-w-0">
                    <p className="font-semibold text-parchment [overflow-wrap:anywhere]">
                      {e.title}
                      {!e.isPublished && <span className="ml-2 rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-bold uppercase text-parchment-muted">Hidden</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-parchment-muted [overflow-wrap:anywhere]">
                      {e.course.title}
                      {e.category && <> · {e.category.name}</>} · {e.language ? e.language.name : <span className="text-danger">No language set</span>} · {e.format} · {formatBytes(e.sizeBytes)} · {e.fileName} · updated {formatDate(e.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:shrink-0">
                  {confirmDelete === e.id ? (
                    <>
                      <button type="button" className="btn-sm rounded-lg bg-danger px-3 text-sm font-semibold text-white" disabled={busyId === e.id} onClick={() => remove(e)}>
                        {busyId === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete file
                      </button>
                      <button type="button" className="btn-outline btn-sm" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-outline btn-sm" onClick={() => preview(e)} title="Open the file">
                        <Download className="h-4 w-4" /> Open
                      </button>
                      <button type="button" className="btn-outline btn-sm" onClick={() => setEditing(e)}>
                        <Pencil className="h-4 w-4" /> Edit / replace
                      </button>
                      <button type="button" className="btn-outline btn-sm" disabled={busyId === e.id} onClick={() => togglePublished(e)}>
                        {e.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {e.isPublished ? "Hide" : "Publish"}
                      </button>
                      <button type="button" className="btn-outline btn-sm text-danger" onClick={() => setConfirmDelete(e.id)} aria-label={`Delete ${e.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <EBookForm
          ebook={editing === "new" ? null : editing}
          courses={courses}
          categories={categories}
          languages={languages}
          defaultCourse={filter || defaultCourse}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            push("success", message);
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function EBookForm({
  ebook,
  courses,
  categories,
  languages,
  defaultCourse,
  onClose,
  onSaved,
}: {
  ebook: AdminEBook | null;
  courses: PackageOption[];
  categories: AdminCategory[];
  languages: AdminLanguage[];
  defaultCourse: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(ebook?.title ?? "");
  const [description, setDescription] = useState(ebook?.description ?? "");
  const [courseId, setCourseId] = useState(ebook?.courseId ?? defaultCourse);
  const [categoryId, setCategoryId] = useState(ebook?.categoryId ?? "");
  const [languageId, setLanguageId] = useState(ebook?.languageId ?? "");
  const [isPublished, setIsPublished] = useState(ebook?.isPublished ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = stage !== "idle";
  useWarnBeforeUnload(busy);

  function pick(f: File | undefined) {
    setFileError(null);
    if (!f) return setFile(null);
    const check = checkEBookFile(f);
    if ("error" in check) {
      setFile(null);
      setFileError(check.error);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 150));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ebook && !file) return setFileError("Choose the e-book file.");
    if (!courseId) return setError("Choose a package.");
    if (!languageId) return setError("Choose the e-book's language.");
    let storageKey: string | null = null;
    try {
      if (file) {
        const check = checkEBookFile(file);
        if ("error" in check) return setFileError(check.error);
        setStage("uploading");
        storageKey = await uploadEBookFile(file, check.contentType, setProgress);
      }
      setStage("saving");
      const fields = { title: title.trim(), description: description.trim() || null, courseId, categoryId: categoryId || null, languageId, isPublished };
      if (ebook) {
        await learningService.updateEBook(ebook.id, { ...fields, ...(storageKey && file ? { storageKey, fileName: file.name } : {}) });
        onSaved(storageKey ? "File replaced — students now get the new version." : "E-book updated.");
      } else {
        await learningService.createEBook({ ...fields, storageKey: storageKey!, fileName: file!.name });
        onSaved(isPublished ? "E-book uploaded and published." : "E-book uploaded (hidden).");
      }
    } catch (err) {
      // An upload that didn't become (part of) an e-book is removed again.
      if (storageKey) void learningService.discardEBookUpload(storageKey).catch(() => undefined);
      setError(errorText(err, "Could not save the e-book."));
      setStage("idle");
    }
  }

  return (
    <Modal title={ebook ? "Edit e-book" : "Upload e-book"} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label-field" htmlFor="ebook-file">
            {ebook ? "Replace file (optional)" : "E-book file"}
          </label>
          <label
            htmlFor="ebook-file"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong p-5 text-center text-sm text-parchment-muted transition hover:border-gold-500/60"
          >
            {ebook && !file ? <RefreshCw className="h-6 w-6 text-gold-500" /> : <UploadCloud className="h-6 w-6 text-gold-500" />}
            {file ? (
              <span className="text-parchment [overflow-wrap:anywhere]">
                {file.name} · {formatBytes(file.size)}
              </span>
            ) : ebook ? (
              <span className="[overflow-wrap:anywhere]">
                Current: {ebook.fileName} ({formatBytes(ebook.sizeBytes)}). Choose a file to replace it.
              </span>
            ) : (
              <span>Choose a PDF or EPUB (max 100 MB)</span>
            )}
          </label>
          <input
            ref={inputRef}
            id="ebook-file"
            type="file"
            accept=".pdf,.epub,application/pdf,application/epub+zip"
            className="sr-only"
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {fileError && <p className="field-error">{fileError}</p>}
        </div>

        <div>
          <label className="label-field" htmlFor="ebook-title">
            Title
          </label>
          <input id="ebook-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={150} disabled={busy} />
        </div>
        <div>
          <label className="label-field" htmlFor="ebook-description">
            Description <span className="font-normal text-parchment-muted">(optional)</span>
          </label>
          <textarea id="ebook-description" className="input-field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} disabled={busy} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="ebook-course">
              Package (who can download)
            </label>
            <select id="ebook-course" className="input-field" value={courseId} onChange={(e) => setCourseId(e.target.value)} required disabled={busy}>
              <option value="" disabled>
                Choose a package
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {packageLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field" htmlFor="ebook-category">
              Category <span className="font-normal text-parchment-muted">(optional)</span>
            </label>
            <select id="ebook-category" className="input-field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
              <option value="">None</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name}</option>
                  {c.subcategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {c.name} › {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <LanguageSelect id="ebook-language" languages={languages} value={languageId} onChange={setLanguageId} required disabled={busy} />
        </div>
        <label className="flex items-center gap-2 text-sm text-parchment">
          <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} disabled={busy} />
          Visible to customers who bought the package
        </label>

        {stage !== "idle" && (
          <UploadProgressPanel label={stage === "uploading" ? "Uploading file…" : "Checking file and saving…"} progress={progress} speed={null} determinate={stage === "uploading"} />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-gold" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {ebook ? "Save changes" : "Upload e-book"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

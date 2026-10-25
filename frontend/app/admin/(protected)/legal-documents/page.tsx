"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { put } from "@vercel/blob/client";
import { Download, Eye, EyeOff, FileCheck2, Loader2, Pencil, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Modal } from "@/components/admin/modal";
import { UploadProgressPanel, errorText, useWarnBeforeUnload } from "@/components/admin/video-shared";
import { ToastStack, useToasts } from "@/components/toast";
import type { UploadProgress } from "@/lib/video-upload";
import { formatDate } from "@/lib/format";
import { formatBytes } from "@/services/videoService";
import { openAfter } from "@/services/learningService";
import {
  LEGAL_DOCUMENT_TYPES,
  MAX_LEGAL_DOCUMENT_BYTES,
  legalDocumentService,
  type AdminLegalDocument,
  type LegalDocumentType,
} from "@/services/legalDocumentService";

function checkPdf(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files can be uploaded.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_LEGAL_DOCUMENT_BYTES) return "Documents can be at most 20 MB.";
  return null;
}

/** Browser → private Blob store with a token scoped to one path, PDF only, 20 MB; returns the storage key. */
async function uploadPdf(file: File, onProgress: (p: UploadProgress) => void) {
  const { pathname, clientToken } = await legalDocumentService.uploadToken({ filename: file.name, contentType: "application/pdf", sizeBytes: file.size });
  await put(pathname, file, { access: "private", token: clientToken, contentType: "application/pdf", onUploadProgress: onProgress });
  return pathname;
}

export default function AdminLegalDocumentsPage() {
  const { toasts, push, dismiss } = useToasts();
  const [documents, setDocuments] = useState<AdminLegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminLegalDocument | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocuments((await legalDocumentService.adminList()).documents);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load documents."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  async function togglePublished(d: AdminLegalDocument) {
    setBusyId(d.id);
    try {
      await legalDocumentService.update(d.id, { isPublished: !d.isPublished });
      push("success", d.isPublished ? "Document hidden from customers." : "Document published to customers.");
      await load();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(d: AdminLegalDocument) {
    setBusyId(d.id);
    try {
      await legalDocumentService.remove(d.id);
      push("success", `“${d.title}” deleted.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function preview(d: AdminLegalDocument) {
    try {
      await openAfter(async () => (await legalDocumentService.preview(d.id)).url);
    } catch (err) {
      push("error", errorText(err, "Could not open the file."));
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Company Legal Documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-parchment-muted">
            PDFs up to 20 MB, stored privately. Customers see a document only after you publish it, through links that expire after 5 minutes.
            Upload only genuine documents the company owner has approved.
          </p>
        </div>
        <button type="button" className="btn-gold btn-sm shrink-0" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Upload document
        </button>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="card p-5 text-sm text-danger">{error}</p>
        ) : !documents ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        ) : documents.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <FileCheck2 className="h-10 w-10 text-gold-500" />
            <p className="text-sm text-parchment-muted">No documents yet. Upload the first one — it stays hidden until you publish it.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {documents.map((d) => (
              <li key={d.id} className="card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
                  <div className="min-w-0">
                    <p className="font-semibold text-parchment [overflow-wrap:anywhere]">
                      {d.title}
                      <span
                        className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          d.isPublished ? "border-emerald/40 text-emerald" : "border-border-strong text-parchment-muted"
                        }`}
                      >
                        {d.isPublished ? "Published" : "Hidden"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-parchment-muted [overflow-wrap:anywhere]">
                      {LEGAL_DOCUMENT_TYPES[d.type]} · {formatBytes(d.sizeBytes)} · {d.fileName} · last updated {formatDate(d.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:shrink-0">
                  {confirmDelete === d.id ? (
                    <>
                      <button type="button" className="btn-sm rounded-lg bg-danger px-3 text-sm font-semibold text-white" disabled={busyId === d.id} onClick={() => remove(d)}>
                        {busyId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete document
                      </button>
                      <button type="button" className="btn-outline btn-sm" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-outline btn-sm" onClick={() => preview(d)} title="Open the file">
                        <Download className="h-4 w-4" /> Open
                      </button>
                      <button type="button" className="btn-outline btn-sm" onClick={() => setEditing(d)}>
                        <Pencil className="h-4 w-4" /> Edit / replace
                      </button>
                      <button type="button" className="btn-outline btn-sm" disabled={busyId === d.id} onClick={() => togglePublished(d)}>
                        {d.isPublished ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {d.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" className="btn-outline btn-sm text-danger" onClick={() => setConfirmDelete(d.id)} aria-label={`Delete ${d.title}`}>
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
        <DocumentForm
          document={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            push("success", message);
            setEditing(null);
            void load();
          }}
        />
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function DocumentForm({ document, onClose, onSaved }: { document: AdminLegalDocument | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(document?.title ?? "");
  const [type, setType] = useState<LegalDocumentType | "">(document?.type ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [isPublished, setIsPublished] = useState(document?.isPublished ?? false);
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
    const problem = checkPdf(f);
    if (problem) {
      setFile(null);
      setFileError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 150));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!document && !file) return setFileError("Choose the PDF file.");
    if (!type) return setError("Choose the document type.");
    let storageKey: string | null = null;
    try {
      if (file) {
        const problem = checkPdf(file);
        if (problem) return setFileError(problem);
        setStage("uploading");
        storageKey = await uploadPdf(file, setProgress);
      }
      setStage("saving");
      const fields = { title: title.trim(), type, description: description.trim() || null, isPublished };
      if (document) {
        await legalDocumentService.update(document.id, { ...fields, ...(storageKey && file ? { storageKey, fileName: file.name } : {}) });
        onSaved(storageKey ? "File replaced — customers now get the new version." : "Document updated.");
      } else {
        await legalDocumentService.create({ ...fields, storageKey: storageKey!, fileName: file!.name });
        onSaved(isPublished ? "Document uploaded and published." : "Document uploaded (hidden until you publish it).");
      }
    } catch (err) {
      // An upload that didn't become (part of) a document is removed again.
      if (storageKey) void legalDocumentService.discardUpload(storageKey).catch(() => undefined);
      setError(errorText(err, "Could not save the document."));
      setStage("idle");
    }
  }

  return (
    <Modal title={document ? "Edit document" : "Upload document"} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label-field" htmlFor="legal-file">
            {document ? "Replace file (optional)" : "PDF file"}
          </label>
          <label
            htmlFor="legal-file"
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong p-5 text-center text-sm text-parchment-muted transition hover:border-gold-500/60"
          >
            {document && !file ? <RefreshCw className="h-6 w-6 text-gold-500" /> : <UploadCloud className="h-6 w-6 text-gold-500" />}
            {file ? (
              <span className="text-parchment [overflow-wrap:anywhere]">
                {file.name} · {formatBytes(file.size)}
              </span>
            ) : document ? (
              <span className="[overflow-wrap:anywhere]">
                Current: {document.fileName} ({formatBytes(document.sizeBytes)}). Choose a file to replace it.
              </span>
            ) : (
              <span>Choose a PDF (max 20 MB)</span>
            )}
          </label>
          <input ref={inputRef} id="legal-file" type="file" accept=".pdf,application/pdf" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
          {fileError && <p className="field-error">{fileError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="legal-title">
              Title
            </label>
            <input id="legal-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={150} disabled={busy} />
          </div>
          <div>
            <label className="label-field" htmlFor="legal-type">
              Document type
            </label>
            <select id="legal-type" className="input-field" value={type} onChange={(e) => setType(e.target.value as LegalDocumentType)} required disabled={busy}>
              <option value="" disabled>
                Choose a type…
              </option>
              {Object.entries(LEGAL_DOCUMENT_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="legal-description">
            Description <span className="font-normal text-parchment-muted">(optional)</span>
          </label>
          <textarea id="legal-description" className="input-field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} disabled={busy} />
        </div>
        <label className="flex items-center gap-2 text-sm text-parchment">
          <input id="legal-published" type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} disabled={busy} />
          Published — visible to customers in their dashboard
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
            {document ? "Save changes" : "Upload document"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

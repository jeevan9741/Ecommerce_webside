"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { ACCEPT_ATTR, checkFile } from "@/lib/franchise-form";
import { MAX_ADDITIONAL_FILES, REPLY_MAX, fieldFor, kindLabel, replyFormError, type DocRequest } from "@/lib/franchise-doc-request";

/** The applicant's answer to an open request: one file per requested document (up to 3 "other"), and/or a written reply. */
export function ReplyToRequest({ request }: { request: DocRequest }) {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(kind: string, list: FileList | null) {
    const chosen = list ? [...list] : [];
    for (const f of chosen) {
      const problem = checkFile(f);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setError(null);
    setFiles((prev) => ({ ...prev, [kind]: chosen }));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const counts = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length]));
    const problem = replyFormError(request, counts, text);
    if (problem) return setError(problem);
    const body = new FormData();
    if (text.trim()) body.set("responseText", text.trim());
    for (const [kind, list] of Object.entries(files)) {
      const field = fieldFor(kind);
      if (field) for (const f of list) body.append(field, f, f.name);
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/franchise/applications/me/document-requests/${encodeURIComponent(request.id)}/reply`, body);
      router.push("/franchise/application?replied=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="mt-4 space-y-4" noValidate>
      {request.kinds.map((kind) => (
        <div key={kind}>
          <label htmlFor={`reply-${kind}`} className="label-field">
            {kindLabel(kind)}{kind === "ADDITIONAL" ? ` (up to ${MAX_ADDITIONAL_FILES} files)` : ""}
          </label>
          <input id={`reply-${kind}`} type="file" accept={ACCEPT_ATTR} multiple={kind === "ADDITIONAL"} onChange={(e) => pick(kind, e.target.files)} className="input-field text-sm" />
        </div>
      ))}
      <p className="text-xs text-parchment-muted">PDF, JPEG or PNG, up to 5 MB each. Earlier files are kept; the new ones become the current version.</p>
      <div>
        <label htmlFor="reply-text" className="label-field">Your reply{request.kinds.length ? " (optional)" : ""}</label>
        <textarea id="reply-text" rows={3} maxLength={REPLY_MAX} value={text} onChange={(e) => setText(e.target.value)} className="input-field resize-none text-sm" />
        <p className="mt-1 text-xs text-parchment-muted">{text.trim().length}/{REPLY_MAX}</p>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn-gold">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Send
      </button>
    </form>
  );
}

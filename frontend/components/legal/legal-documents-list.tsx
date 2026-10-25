"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ExternalLink, FileCheck2, Loader2, RotateCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { formatBytes } from "@/services/videoService";
import { openAfter } from "@/services/learningService";
import { LEGAL_DOCUMENT_TYPES, legalDocumentService, type LegalDocument } from "@/services/legalDocumentService";

/**
 * The company's published legal documents. Opening one goes through the API, which returns a
 * 5-minute signed link — nothing here is a permanent file URL.
 */
export function LegalDocumentsList() {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    legalDocumentService
      .published()
      .then(({ documents }) => setDocuments(documents))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the documents."));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  if (error) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-danger" />
        <p className="text-sm text-danger">{error}</p>
        <button type="button" onClick={load} className="btn-outline btn-sm">
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }
  if (!documents) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading documents">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-40 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (documents.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <FileCheck2 className="h-10 w-10 text-gold-500" />
        <p className="font-semibold text-parchment">No documents published yet</p>
        <p className="max-w-md text-sm text-parchment-muted">
          The academy&apos;s registration certificates and policies will appear here once they&apos;re published. Please check back later.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {documents.map((d) => (
        <DocumentCard key={d.id} document={d} />
      ))}
    </div>
  );
}

function DocumentCard({ document: d }: { document: LegalDocument }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    setBusy(true);
    try {
      await openAfter(async () => (await legalDocumentService.download(d.id)).url);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This document is no longer available."
          : err instanceof ApiError && err.status === 429
            ? err.message
            : "The document couldn't open. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex h-full min-w-0 flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-md">
          <FileCheck2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-parchment [overflow-wrap:anywhere]">{d.title}</h3>
          <p className="mt-0.5 text-xs text-parchment-muted">
            {LEGAL_DOCUMENT_TYPES[d.type] ?? "Document"} · PDF · {formatBytes(d.sizeBytes)}
          </p>
          <p className="mt-0.5 text-xs text-parchment-muted">Last updated {formatDate(d.updatedAt)}</p>
        </div>
      </div>
      {d.description && <p className="mt-3 whitespace-pre-line text-sm text-parchment-muted">{d.description}</p>}
      <div className="mt-auto pt-4">
        <button type="button" onClick={open} disabled={busy} className="btn-gold btn-block !px-4 text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {busy ? "Opening…" : "View / Download"}
        </button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

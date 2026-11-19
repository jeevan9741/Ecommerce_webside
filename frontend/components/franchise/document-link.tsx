"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Asks for a fresh short-lived signed link only when clicked; links are never rendered into the page.
 * By default it is the applicant's own document; the admin review page passes its own request.
 */
export function DocumentLink({ documentId, request }: { documentId: string; request?: () => Promise<{ url: string }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const { url } = request ? await request() : await api.get<{ url: string }>(`/franchise/applications/me/documents/${encodeURIComponent(documentId)}/url`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button type="button" onClick={open} disabled={busy} className="btn-outline btn-sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "View"}
      </button>
    </span>
  );
}

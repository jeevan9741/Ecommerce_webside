"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { withdrawBody, withdrawPrompt } from "@/lib/franchise-withdraw";

/**
 * Lets the applicant withdraw their own application (the server decides whether that's still possible).
 * After approval it warns that the approval is given up and waits for an explicit acknowledgement.
 */
export function WithdrawApplication({ needsConfirmation = false }: { needsConfirmation?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prompt = withdrawPrompt(needsConfirmation);
  const body = withdrawBody(needsConfirmation, acknowledged);

  async function withdraw() {
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/franchise/applications/me/withdraw", body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn-outline btn-sm mt-6">
        Withdraw application
      </button>
    );
  }
  return (
    <div className={`mt-6 rounded-xl border p-4 text-sm ${needsConfirmation ? "border-gold-500/60 bg-gold-500/5" : "border-white/10"}`} role="group" aria-label="Confirm withdrawal">
      <p className="flex gap-2 text-parchment">
        {needsConfirmation && <AlertTriangle className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />}
        {prompt.warning}
      </p>
      {prompt.acknowledgement && (
        <label className="mt-3 flex items-start gap-2 text-parchment">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1" />
          <span>{prompt.acknowledgement}</span>
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={withdraw} disabled={busy || !body} className="btn-gold btn-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Withdrawing" /> : "Yes, withdraw"}
        </button>
        <button type="button" onClick={() => { setConfirming(false); setAcknowledged(false); }} disabled={busy} className="btn-outline btn-sm">
          Keep it
        </button>
      </div>
    </div>
  );
}

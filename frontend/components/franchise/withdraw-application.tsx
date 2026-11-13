"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/** Lets the applicant withdraw their own application (the server decides whether that's still possible). */
export function WithdrawApplication() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/franchise/applications/me/withdraw", {});
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
    <div className="mt-6 rounded-xl border border-white/10 p-4 text-sm" role="group" aria-label="Confirm withdrawal">
      <p className="text-parchment">Withdraw this application? This can&apos;t be undone, though you can apply again later.</p>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button type="button" onClick={withdraw} disabled={busy} className="btn-gold btn-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Withdrawing" /> : "Yes, withdraw"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="btn-outline btn-sm">
          Keep it
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/** The student's explicit consent: one click, from their own signed-in account. */
export function AcceptInvite({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setState("busy");
    setError(null);
    try {
      await api.post(`/franchise-invites/${encodeURIComponent(token)}/accept`);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-emerald">
        <CheckCircle2 className="h-5 w-5" /> You&apos;ve joined the franchise.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" disabled={state === "busy"} onClick={accept} className="btn-gold">
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept invitation"}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

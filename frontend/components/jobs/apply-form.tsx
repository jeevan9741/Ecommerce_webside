"use client";

import { backendFetch } from "@/lib/api";

import { useState, FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

export function ApplyForm({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const res = await backendFetch(`/api/jobs/${jobId}/apply`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit application");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit application");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald" />
        <h3 className="text-lg font-semibold text-parchment">Application received</h3>
        <p className="text-sm text-parchment-muted">
          Thank you for applying. Our team will reach out if your profile is a fit.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6 sm:p-8">
      <h3 className="font-display text-xl font-semibold text-parchment">Apply for this role</h3>
      <div>
        <label className="label-field">Full Name</label>
        <input name="applicantName" required className="input-field" placeholder="Jane Doe" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label-field">Email</label>
          <input type="email" name="email" required className="input-field" placeholder="you@example.com" />
        </div>
        <div>
          <label className="label-field">Phone</label>
          <input name="phone" required className="input-field" placeholder="9876543210" />
        </div>
      </div>
      <div>
        <label className="label-field">Resume (PDF or Word, max 5MB)</label>
        <input
          type="file"
          name="resume"
          accept=".pdf,.doc,.docx"
          className="input-field file:mr-4 file:rounded-full file:border-0 file:bg-gold-500 file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
        />
      </div>
      <div>
        <label className="label-field">Cover Note (optional)</label>
        <textarea name="coverNote" rows={4} className="input-field resize-none" placeholder="Tell us why you're a great fit..." />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn-gold w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Application"}
      </button>
    </form>
  );
}

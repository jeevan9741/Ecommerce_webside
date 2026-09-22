"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BadgeIndianRupee, Loader2, Package, Phone, Receipt, Send, User } from "lucide-react";
import { backendFetch } from "@/lib/api";
import { formatDate, formatInr } from "@/lib/format";
import { useToasts, ToastStack } from "@/components/toast";

export interface ClaimPackageOption {
  id: string;
  label: string;
}

export interface ReferralClaimRow {
  id: string;
  studentName: string;
  utr: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  commissionInPaise: number | null;
  adminNote: string | null;
  createdAt: string;
  course: { title: string };
}

const EMPTY = { studentName: "", studentPhone: "", courseId: "", utr: "" };

const STATUS_STYLES: Record<ReferralClaimRow["status"], string> = {
  PENDING: "bg-gold-500/10 text-gold-600 border-gold-500/40",
  APPROVED: "bg-emerald/15 text-emerald border-emerald",
  REJECTED: "bg-danger/10 text-danger border-danger/40",
};

export function ReferralClaimForm({
  packages,
  claims,
}: {
  packages: ClaimPackageOption[];
  /** null when the claims list couldn't be loaded. */
  claims: ReferralClaimRow[] | null;
}) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const studentName = form.studentName.trim();
    const studentPhone = form.studentPhone.replace(/[\s-]/g, "");
    const utr = form.utr.trim().toUpperCase();

    // Mirrors the backend rules so most mistakes are caught before a round trip.
    if (studentName.length < 2) return push("error", "Please enter the student's full name.");
    if (!/^\+?[0-9]{10,15}$/.test(studentPhone)) return push("error", "Please enter a valid 10–15 digit phone number.");
    if (!form.courseId) return push("error", "Please choose the package the student enrolled in.");
    if (!/^[A-Z0-9]{10,30}$/.test(utr)) return push("error", "Please enter a valid UPI UTR number (usually 12 digits).");

    setBusy(true);
    const res = await backendFetch("/api/referral-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentName, studentPhone, courseId: form.courseId, utr }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) return push("error", data.error ?? "Could not submit your claim. Please try again.");

    setForm(EMPTY);
    push("success", "Claim submitted — we'll verify the payment and update your earnings.");
    // Refreshes the server-rendered Pending Approvals count and the claims list below.
    router.refresh();
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-parchment">
        Submit Referred Student&apos;s Order ID / UTR
      </h2>
      <p className="mt-1 text-sm text-parchment-muted">
        Referred a student who paid without your link? Send us their payment reference to claim your commission.
      </p>

      <form onSubmit={onSubmit} className="card mt-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student Full Name" icon={User}>
            <input
              value={form.studentName}
              onChange={(e) => setForm({ ...form, studentName: e.target.value })}
              disabled={busy}
              autoComplete="off"
              className="input-field"
              placeholder="As entered at checkout"
            />
          </Field>
          <Field label="Student Phone Number" icon={Phone}>
            <input
              value={form.studentPhone}
              onChange={(e) => setForm({ ...form, studentPhone: e.target.value })}
              disabled={busy}
              inputMode="tel"
              autoComplete="off"
              className="input-field"
              placeholder="10-digit mobile number"
            />
          </Field>
          <Field label="Enrolled Package" icon={Package}>
            <select
              value={form.courseId}
              onChange={(e) => setForm({ ...form, courseId: e.target.value })}
              disabled={busy}
              className="input-field"
            >
              <option value="">Select a package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment Reference (UPI UTR Number)" icon={Receipt}>
            <input
              value={form.utr}
              onChange={(e) => setForm({ ...form, utr: e.target.value })}
              disabled={busy}
              autoComplete="off"
              className="input-field uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal"
              placeholder="e.g. 412345678901"
            />
          </Field>
        </div>

        <button type="submit" disabled={busy} className="btn-gold btn-block mt-5 sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? "Submitting…" : "Claim Partner Commission"}
        </button>
      </form>

      {claims === null ? (
        <p className="mt-4 text-sm text-parchment-muted">Your previous claims couldn&apos;t be loaded right now.</p>
      ) : (
        claims.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-parchment">Your Claims</h3>
            <ul className="space-y-2">
              {claims.map((c) => (
                <li key={c.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-parchment">
                      {c.studentName} · {c.course.title}
                    </p>
                    <p className="text-xs text-parchment-muted">
                      UTR {c.utr} · {formatDate(c.createdAt)}
                      {c.adminNote ? ` · ${c.adminNote}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.status === "APPROVED" && c.commissionInPaise !== null && (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald">
                        <BadgeIndianRupee className="h-4 w-4" />
                        {formatInr(c.commissionInPaise)}
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${STATUS_STYLES[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </section>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-gold-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{label}</span>
      </span>
      {children}
    </label>
  );
}

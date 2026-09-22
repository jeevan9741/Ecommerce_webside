"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatInr, formatDateTime } from "@/lib/format";

interface Claim {
  id: string;
  studentName: string;
  studentPhone: string;
  utr: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  commissionInPaise: number | null;
  adminNote: string | null;
  createdAt: string;
  partner: { name: string; email: string; referralCode: string };
  course: { title: string; priceInPaise: number };
}

export default function AdminReferralClaimsPage() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Commission (in rupees) and note typed per claim before approving/rejecting.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function load() {
    const data = await backendFetch("/api/admin/referral-claims").then((r) => r.json());
    setClaims(data.claims ?? []);
  }

  useEffect(() => {
    backendFetch("/api/admin/referral-claims")
      .then((r) => r.json())
      .then((data) => setClaims(data.claims ?? []));
  }, []);

  async function review(id: string, action: "APPROVE" | "REJECT") {
    const rupees = Number(amounts[id]);
    if (action === "APPROVE" && !(rupees > 0)) {
      setErrors({ ...errors, [id]: "Enter the commission amount to credit." });
      return;
    }
    setErrors({ ...errors, [id]: "" });
    setBusyId(id);
    const res = await backendFetch(`/api/admin/referral-claims/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        adminNote: notes[id]?.trim() || undefined,
        ...(action === "APPROVE" ? { commissionInPaise: Math.round(rupees * 100) } : {}),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrors((prev) => ({ ...prev, [id]: data.error ?? "Could not update this claim." }));
    }
    await load();
    setBusyId(null);
  }

  if (!claims) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Referral Claims</h1>
      <p className="mt-1 text-sm text-parchment-muted">
        Partners submit these for students who paid without their referral link. Check the UTR against your
        payment records, then approve with the commission to credit — it goes straight into the partner&apos;s
        withdrawable balance.
      </p>

      <div className="mt-6 space-y-3">
        {claims.map((c) => (
          <div key={c.id} className="card flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-parchment">
                  {c.studentName} · {c.studentPhone}
                </p>
                <p className="text-xs text-parchment-muted">
                  {c.course.title} ({formatInr(c.course.priceInPaise)}) · UTR{" "}
                  <span className="font-mono font-semibold text-parchment">{c.utr}</span>
                </p>
                <p className="mt-1 text-xs text-parchment-muted">
                  Claimed by {c.partner.name} ({c.partner.referralCode}) · {formatDateTime(c.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {c.status === "APPROVED" && c.commissionInPaise !== null && (
                  <span className="text-lg font-bold text-parchment">{formatInr(c.commissionInPaise)}</span>
                )}
                <span className="rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-parchment-muted">
                  {c.status}
                </span>
              </div>
            </div>

            {c.adminNote && c.status !== "PENDING" && (
              <p className="text-xs text-parchment-muted">Note: {c.adminNote}</p>
            )}

            {c.status === "PENDING" && (
              <div className="flex flex-col gap-2 border-t border-border-soft pt-4 sm:flex-row sm:items-center">
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={amounts[c.id] ?? ""}
                  onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                  placeholder="Commission ₹"
                  className="input-field !py-2 sm:w-40"
                />
                <input
                  value={notes[c.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                  placeholder="Note to partner (optional)"
                  maxLength={500}
                  className="input-field !py-2 sm:flex-1"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busyId === c.id}
                    onClick={() => review(c.id, "APPROVE")}
                    className="btn-gold !px-4 !py-2 text-xs"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === c.id}
                    onClick={() => review(c.id, "REJECT")}
                    className="btn-outline !px-4 !py-2 text-xs !border-danger !text-danger"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
            {errors[c.id] && <p className="text-xs text-danger">{errors[c.id]}</p>}
          </div>
        ))}
        {claims.length === 0 && (
          <p className="card p-8 text-center text-sm text-parchment-muted">No referral claims yet.</p>
        )}
      </div>
    </div>
  );
}

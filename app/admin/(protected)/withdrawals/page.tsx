"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatInr, formatDateTime } from "@/lib/format";

interface Withdrawal {
  id: string;
  amountInPaise: number;
  status: string;
  requestedAt: string;
  partner: { name: string; email: string; referralCode: string };
  payoutMethod: { type: string; label: string };
}

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const data = await fetch("/api/admin/withdrawals").then((r) => r.json());
    setWithdrawals(data.withdrawals);
  }

  useEffect(() => {
    fetch("/api/admin/withdrawals")
      .then((r) => r.json())
      .then((data) => setWithdrawals(data.withdrawals));
  }, []);

  async function process(id: string, action: "SUCCESS" | "FAILED" | "PROCESSING") {
    setBusyId(id);
    await fetch(`/api/admin/withdrawals/${id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
    setBusyId(null);
  }

  if (!withdrawals) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Withdrawal Requests</h1>
      <p className="mt-1 text-sm text-parchment-muted">
        RazorpayX auto-payouts are disabled until business KYC is complete — process manually below, then mark as
        Success once the transfer is done outside the app.
      </p>

      <div className="mt-6 space-y-3">
        {withdrawals.map((w) => (
          <div key={w.id} className="card flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium text-parchment">{w.partner.name} ({w.partner.referralCode})</p>
              <p className="text-xs text-parchment-muted">
                {w.payoutMethod.label} · {w.payoutMethod.type} · {formatDateTime(w.requestedAt)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-parchment">{formatInr(w.amountInPaise)}</span>
              <span className="rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-parchment-muted">
                {w.status}
              </span>
              {(w.status === "PENDING" || w.status === "PROCESSING") && (
                <div className="flex gap-2">
                  {w.status === "PENDING" && (
                    <button
                      disabled={busyId === w.id}
                      onClick={() => process(w.id, "PROCESSING")}
                      className="btn-outline !px-3 !py-1.5 text-xs"
                    >
                      Mark Processing
                    </button>
                  )}
                  <button
                    disabled={busyId === w.id}
                    onClick={() => process(w.id, "SUCCESS")}
                    className="btn-gold !px-3 !py-1.5 text-xs"
                  >
                    Mark Paid
                  </button>
                  <button
                    disabled={busyId === w.id}
                    onClick={() => process(w.id, "FAILED")}
                    className="btn-outline !px-3 !py-1.5 text-xs !border-danger !text-danger"
                  >
                    Mark Failed
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {withdrawals.length === 0 && (
          <p className="card p-8 text-center text-sm text-parchment-muted">No withdrawal requests yet.</p>
        )}
      </div>
    </div>
  );
}

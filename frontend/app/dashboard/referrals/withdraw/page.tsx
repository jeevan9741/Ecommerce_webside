"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Landmark, Smartphone } from "lucide-react";
import { formatInr, formatDate } from "@/lib/format";

interface PayoutMethod {
  id: string;
  type: "BANK" | "UPI";
  label: string;
  createdAt: string;
}
interface Withdrawal {
  id: string;
  amountInPaise: number;
  status: string;
  requestedAt: string;
  payoutMethod: { type: string; label: string };
}

export default function WithdrawPage() {
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [available, setAvailable] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showAddMethod, setShowAddMethod] = useState(false);
  const [methodType, setMethodType] = useState<"UPI" | "BANK">("UPI");
  const [methodBusy, setMethodBusy] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);

  const [selectedMethod, setSelectedMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  async function loadAll() {
    const [methodsRes, withdrawalsRes, statsRes] = await Promise.all([
      backendFetch("/api/payout-methods").then((r) => r.json()),
      backendFetch("/api/withdrawals").then((r) => r.json()),
      backendFetch("/api/partner/stats").then((r) => r.json()),
    ]);
    setMethods(methodsRes.methods ?? []);
    setWithdrawals(withdrawalsRes.withdrawals ?? []);
    setAvailable(statsRes.balance?.availableInPaise ?? 0);
    if (methodsRes.methods?.[0]) setSelectedMethod(methodsRes.methods[0].id);
    setLoading(false);
  }

  useEffect(() => {
    Promise.all([
      backendFetch("/api/payout-methods").then((r) => r.json()),
      backendFetch("/api/withdrawals").then((r) => r.json()),
      backendFetch("/api/partner/stats").then((r) => r.json()),
    ]).then(([methodsRes, withdrawalsRes, statsRes]) => {
      setMethods(methodsRes.methods ?? []);
      setWithdrawals(withdrawalsRes.withdrawals ?? []);
      setAvailable(statsRes.balance?.availableInPaise ?? 0);
      if (methodsRes.methods?.[0]) setSelectedMethod(methodsRes.methods[0].id);
      setLoading(false);
    });
  }, []);

  async function addMethod(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMethodError(null);
    setMethodBusy(true);
    const form = new FormData(e.currentTarget);
    const payload =
      methodType === "UPI"
        ? { type: "UPI", label: form.get("label"), upiId: form.get("upiId") }
        : {
            type: "BANK",
            label: form.get("label"),
            accountHolderName: form.get("accountHolderName"),
            accountNumber: form.get("accountNumber"),
            ifsc: form.get("ifsc"),
          };
    try {
      const res = await backendFetch("/api/payout-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setShowAddMethod(false);
      await loadAll();
    } catch (err) {
      setMethodError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setMethodBusy(false);
    }
  }

  async function requestWithdrawal(e: FormEvent) {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawSuccess(false);
    setWithdrawBusy(true);
    try {
      const amountInPaise = Math.round(parseFloat(amount) * 100);
      const res = await backendFetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutMethodId: selectedMethod, amountInPaise }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit request");
      setWithdrawSuccess(true);
      setAmount("");
      await loadAll();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setWithdrawBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/dashboard/referrals"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-parchment-muted hover:text-gold-400"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Referral & Earnings
      </Link>
      <h1 className="font-display text-2xl font-semibold text-parchment">Withdraw Commission</h1>
      <p className="mt-1 text-sm text-parchment-muted">
        Available balance: <span className="font-semibold text-gold-400">{formatInr(available)}</span>
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-parchment">Payout Methods</h2>
            <button onClick={() => setShowAddMethod((v) => !v)} className="btn-outline !px-3 !py-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add Method
            </button>
          </div>

          <div className="space-y-3">
            {methods.map((m) => (
              <label
                key={m.id}
                className={`card flex cursor-pointer items-center gap-3 p-4 ${
                  selectedMethod === m.id ? "border-gold-500" : ""
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  checked={selectedMethod === m.id}
                  onChange={() => setSelectedMethod(m.id)}
                  className="accent-gold-500"
                />
                {m.type === "UPI" ? (
                  <Smartphone className="h-4 w-4 text-gold-500" />
                ) : (
                  <Landmark className="h-4 w-4 text-gold-500" />
                )}
                <span className="text-sm text-parchment">{m.label}</span>
                <span className="ml-auto text-xs text-parchment-muted">{m.type}</span>
              </label>
            ))}
            {methods.length === 0 && !showAddMethod && (
              <p className="card p-6 text-center text-sm text-parchment-muted">
                Add a bank account or UPI ID to request withdrawals.
              </p>
            )}
          </div>

          {showAddMethod && (
            <form onSubmit={addMethod} className="card mt-4 space-y-4 p-5">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMethodType("UPI")}
                  className={`btn-outline !px-4 !py-2 text-xs ${methodType === "UPI" ? "border-gold-500 text-gold-400" : ""}`}
                >
                  UPI
                </button>
                <button
                  type="button"
                  onClick={() => setMethodType("BANK")}
                  className={`btn-outline !px-4 !py-2 text-xs ${methodType === "BANK" ? "border-gold-500 text-gold-400" : ""}`}
                >
                  Bank Account
                </button>
              </div>
              <div>
                <label className="label-field">Label</label>
                <input name="label" required className="input-field" placeholder="My UPI / My Bank" />
              </div>
              {methodType === "UPI" ? (
                <div>
                  <label className="label-field">UPI ID</label>
                  <input name="upiId" required className="input-field" placeholder="name@bank" />
                </div>
              ) : (
                <>
                  <div>
                    <label className="label-field">Account Holder Name</label>
                    <input name="accountHolderName" required className="input-field" />
                  </div>
                  <div>
                    <label className="label-field">Account Number</label>
                    <input name="accountNumber" required className="input-field" />
                  </div>
                  <div>
                    <label className="label-field">IFSC Code</label>
                    <input name="ifsc" required className="input-field uppercase" />
                  </div>
                </>
              )}
              {methodError && <p className="text-sm text-danger">{methodError}</p>}
              <button type="submit" disabled={methodBusy} className="btn-gold w-full">
                {methodBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Method"}
              </button>
            </form>
          )}
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold text-parchment">Request Withdrawal</h2>
          <form onSubmit={requestWithdrawal} className="card mt-4 space-y-4 p-5">
            <div>
              <label className="label-field">Amount (₹)</label>
              <input
                type="number"
                min={100}
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field"
                placeholder="Minimum ₹100"
              />
            </div>
            {withdrawError && <p className="text-sm text-danger">{withdrawError}</p>}
            {withdrawSuccess && <p className="text-sm text-emerald">Withdrawal request submitted.</p>}
            <button
              type="submit"
              disabled={withdrawBusy || !selectedMethod}
              className="btn-gold w-full"
            >
              {withdrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Request"}
            </button>
          </form>

          <h3 className="mt-8 mb-3 text-sm font-semibold text-parchment">Withdrawal History</h3>
          <div className="space-y-2">
            {withdrawals.length === 0 && (
              <p className="card p-5 text-center text-xs text-parchment-muted">No withdrawal requests yet.</p>
            )}
            {withdrawals.map((w) => (
              <div key={w.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-parchment">{formatInr(w.amountInPaise)}</p>
                  <p className="text-xs text-parchment-muted">
                    {w.payoutMethod.label} · {formatDate(w.requestedAt)}
                  </p>
                </div>
                <span className="text-xs font-medium text-gold-400">{w.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

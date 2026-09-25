"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { formatInr } from "@/lib/format";
import type { PartnerCardSettings } from "@/lib/partner-card/types";
import { partnerCardService } from "@/services/partnerCardService";
import { errorMessage } from "@/components/partner-card/partner-card-manager";
import { ToastStack, useToasts } from "@/components/toast";

export default function PartnerCardSettingsPage() {
  const [saved, setSaved] = useState<PartnerCardSettings | null>(null);
  const [freeCards, setFreeCards] = useState("1");
  const [fee, setFee] = useState("99");
  const [paymentEnabled, setPaymentEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  function apply(s: PartnerCardSettings) {
    setSaved(s);
    setFreeCards(String(s.freeCardsAllowed));
    setFee(String(s.reissueFeeInPaise / 100));
    setPaymentEnabled(s.reissuePaymentEnabled);
  }

  useEffect(() => {
    partnerCardService
      .settings()
      .then(({ settings }) => apply(settings))
      .catch((err) => setError(errorMessage(err, "Could not load settings.")));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const freeCardsAllowed = Number(freeCards);
    const rupees = Number(fee);
    if (!Number.isInteger(freeCardsAllowed) || freeCardsAllowed < 1 || freeCardsAllowed > 10) {
      push("error", "Free cards allowed must be a whole number from 1 to 10.");
      return;
    }
    if (!(rupees >= 0) || rupees > 100000) {
      push("error", "Enter a reissue fee between ₹0 and ₹1,00,000.");
      return;
    }
    setBusy(true);
    try {
      const { settings } = await partnerCardService.saveSettings({
        freeCardsAllowed,
        reissueFeeInPaise: Math.round(rupees * 100),
        reissuePaymentEnabled: paymentEnabled,
      });
      apply(settings);
      push("success", "Partner card settings saved.");
    } catch (err) {
      push("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href="/admin/partner-cards" className="inline-flex items-center gap-1 text-xs font-semibold text-gold-500 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Partner ID Cards
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-parchment">Partner Card Settings</h1>
      <p className="mt-1 text-sm text-parchment-muted">
        Controls how many cards a partner gets free and what a reissue costs. Changes apply to new requests; requests
        already awaiting payment keep the fee they were quoted.
      </p>

      {error && <p className="card mt-6 p-5 text-sm text-danger">{error}</p>}
      {!saved && !error && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      )}

      {saved && (
        <form onSubmit={submit} className="card mt-6 space-y-5 p-5 sm:p-6">
          <label className="block">
            <span className="label-field">Free cards allowed</span>
            <input type="number" min={1} max={10} step={1} value={freeCards} onChange={(e) => setFreeCards(e.target.value)} className="input-field sm:w-40" />
            <span className="field-hint">Includes the first card. Default: 1 (only the first card is free).</span>
          </label>

          <label className="block">
            <span className="label-field">Reissue fee (₹)</span>
            <input type="number" min={0} step={1} value={fee} onChange={(e) => setFee(e.target.value)} className="input-field sm:w-40" />
            <span className="field-hint">Charged for each card beyond the free allowance. Default: ₹99. Can be overridden per partner.</span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-border-soft p-4">
            <input type="checkbox" checked={paymentEnabled} onChange={(e) => setPaymentEnabled(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-semibold text-parchment">Require payment for reissues</span>
              <span className="block text-xs text-parchment-muted">
                When off, reissue requests skip payment and go straight to admin approval.
              </span>
            </span>
          </label>

          <div className="rounded-xl bg-ink p-4 text-sm text-parchment-muted">
            Partners see:{" "}
            <span className="font-semibold text-parchment">
              {Number(freeCards) > 1 ? `${freeCards} free cards` : "one free card"}, then{" "}
              {paymentEnabled && Number(fee) > 0 ? `${formatInr(Math.round(Number(fee) * 100))} per reissue` : "free reissues (admin approval only)"}
            </span>
            .
          </div>

          <button type="submit" disabled={busy} className="btn-gold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
          </button>
        </form>
      )}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

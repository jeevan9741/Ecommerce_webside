"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

export function ReferralLinkCard({ referralCode }: { referralCode: string }) {
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // window.location is unavailable during SSR; set after mount to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLink(`${window.location.origin}/r/${referralCode}`);
    setCanShare(typeof navigator.share === "function");
  }, [referralCode]);

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    try {
      await navigator.share({
        title: "E-Commerce Training Academy",
        text: "Join E-Commerce Training Academy using my referral link:",
        url: link,
      });
    } catch {
      // User cancelled the share sheet — nothing to do.
    }
  }

  return (
    <div className="card p-6">
      <p className="label-field">Your Referral Code</p>
      <p className="mb-4 text-2xl font-bold tracking-wide text-gold-400">{referralCode}</p>
      <p className="label-field">Shareable Link</p>
      <div className="flex items-center gap-2">
        <input readOnly value={link} className="input-field text-xs" />
        <button onClick={copy} className="btn-outline shrink-0 !px-3 !py-3" aria-label="Copy referral link">
          {copied ? <Check className="h-4 w-4 text-emerald" /> : <Copy className="h-4 w-4" />}
        </button>
        {canShare && (
          <button onClick={share} className="btn-outline shrink-0 !px-3 !py-3" aria-label="Share referral link">
            <Share2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

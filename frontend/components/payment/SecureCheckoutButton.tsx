"use client";

import { motion } from "framer-motion";
import { ArrowRight, Loader2, Lock, ShieldCheck } from "lucide-react";
import { formatInr } from "@/lib/format";

export function SecureCheckoutButton({
  amountInPaise,
  methodLabel,
  loading,
  disabled,
  onClick,
}: {
  amountInPaise: number;
  methodLabel: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading}
        whileHover={disabled || loading ? undefined : { y: -2 }}
        whileTap={disabled || loading ? undefined : { scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-[20px] bg-gradient-to-r from-gold-600 via-gold-500 to-gold-400 px-6 py-4 text-base font-semibold text-white shadow-[0_18px_40px_-14px_rgba(37,99,235,0.7)] outline-none transition-shadow hover:shadow-[0_22px_48px_-12px_rgba(37,99,235,0.8)] focus-visible:ring-2 focus-visible:ring-gold-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Sheen that sweeps across on hover */}
        <span
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/25 blur-md transition-transform duration-700 group-hover:translate-x-[400%]"
          aria-hidden
        />
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span>Preparing secure checkout…</span>
          </>
        ) : (
          <>
            <Lock className="h-5 w-5" aria-hidden />
            <span>Proceed Secure Payment</span>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm">{formatInr(amountInPaise)}</span>
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden />
          </>
        )}
      </motion.button>

      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-parchment-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald" aria-hidden />
        Secured by <span className="font-semibold text-parchment">Razorpay</span> · Paying with {methodLabel}
      </p>
    </div>
  );
}

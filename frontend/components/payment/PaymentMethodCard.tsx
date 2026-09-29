"use client";

import { motion } from "framer-motion";
import { Check, CreditCard, Landmark, Loader2, Smartphone, Zap } from "lucide-react";
import type { PaymentMethod, PaymentMethodId } from "./payment-methods";

/**
 * Original monogram marks in each provider's colours — deliberately not reproductions
 * of their trademarked logos. Swap in official assets here if you license them.
 */
function MethodIcon({ id }: { id: PaymentMethodId }) {
  const tile = "flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg sm:h-14 sm:w-14";
  switch (id) {
    case "upi":
      return (
        <span className={`${tile} bg-gradient-to-br from-emerald to-teal-600`}>
          <Smartphone className="h-6 w-6" aria-hidden />
        </span>
      );
    case "gpay":
      return (
        <span className={`${tile} bg-white ring-1 ring-border-soft`}>
          <span className="text-lg font-extrabold tracking-tight">
            <span className="text-[#4285F4]">G</span>
            <span className="text-parchment">Pay</span>
          </span>
        </span>
      );
    case "phonepe":
      return <span className={`${tile} bg-gradient-to-br from-[#6f3bd6] to-[#4a1fa8] text-xl font-extrabold`}>Pe</span>;
    case "paytm":
      return (
        <span className={`${tile} bg-gradient-to-br from-[#00baf2] to-[#002e6e] text-[13px] font-extrabold tracking-tight`}>
          paytm
        </span>
      );
    case "credit":
      return (
        <span className={`${tile} bg-gradient-to-br from-slate-700 to-slate-900`}>
          <CreditCard className="h-6 w-6" aria-hidden />
        </span>
      );
    case "debit":
      return (
        <span className={`${tile} bg-gradient-to-br from-gold-400 to-gold-600`}>
          <CreditCard className="h-6 w-6" aria-hidden />
        </span>
      );
    case "netbanking":
      return (
        <span className={`${tile} bg-gradient-to-br from-amber-500 to-orange-600`}>
          <Landmark className="h-6 w-6" aria-hidden />
        </span>
      );
  }
}

export function PaymentMethodCard({
  method,
  highlighted,
  pending,
  disabled,
  onPay,
}: {
  method: PaymentMethod;
  highlighted: boolean;
  pending: boolean;
  disabled: boolean;
  onPay: () => void;
}) {
  const active = highlighted || pending;
  return (
    <motion.button
      type="button"
      data-method={method.id}
      data-last={highlighted}
      aria-label={`Pay with ${method.label} — ${method.hint}`}
      aria-busy={pending}
      disabled={disabled}
      onClick={onPay}
      whileHover={disabled ? undefined : { y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 26 }}
      className={`group relative flex h-full min-h-[148px] w-full min-w-0 flex-col items-start gap-3 overflow-hidden rounded-[22px] border p-4 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed sm:p-5 lg:p-4 ${
        active
          ? "border-gold-500 bg-gradient-to-br from-gold-100/80 via-white to-white shadow-[0_18px_40px_-20px_rgba(37,99,235,0.55)]"
          : "border-border-soft bg-white/70 backdrop-blur-sm hover:border-gold-500/40 hover:shadow-[0_14px_32px_-22px_rgba(37,99,235,0.45)]"
      } ${disabled && !pending ? "opacity-60" : ""}`}
    >
      <MethodIcon id={method.id} />

      <span className="min-w-0">
        <span className="block text-sm font-semibold text-parchment sm:text-base">{method.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-parchment-muted sm:text-xs">{method.hint}</span>
      </span>

      {pending ? (
        <span className="mt-auto inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gold-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-white">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Opening…
        </span>
      ) : (
        <span className="mt-auto inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-normal text-emerald transition-colors group-hover:bg-emerald group-hover:text-white sm:text-[10px]">
          <Zap className="h-3 w-3" aria-hidden /> Tap to pay
        </span>
      )}

      {highlighted && !pending && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-gold-500 text-white shadow-md" aria-hidden>
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}
    </motion.button>
  );
}

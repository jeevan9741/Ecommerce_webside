"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Check, CreditCard, Landmark, Smartphone, Zap } from "lucide-react";
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

export const PaymentMethodCard = forwardRef<
  HTMLButtonElement,
  {
    method: PaymentMethod;
    selected: boolean;
    tabIndex: number;
    onSelect: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  }
>(function PaymentMethodCard({ method, selected, tabIndex, onSelect, onKeyDown }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${method.label} — ${method.hint}`}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 26 }}
      className={`group relative flex h-full min-h-[148px] w-full min-w-0 flex-col items-start gap-3 overflow-hidden rounded-[22px] border p-4 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-gold-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink sm:p-5 lg:p-4 ${
        selected
          ? "border-gold-500 bg-gradient-to-br from-gold-100/80 via-white to-white shadow-[0_18px_40px_-20px_rgba(37,99,235,0.55)]"
          : "border-border-soft bg-white/70 backdrop-blur-sm hover:border-gold-500/40 hover:shadow-[0_14px_32px_-22px_rgba(37,99,235,0.45)]"
      }`}
    >
      {/* Selection ring shared across cards so it glides between them */}
      {selected && (
        <motion.span
          layoutId="payment-method-selection"
          className="pointer-events-none absolute inset-0 rounded-[22px] ring-2 ring-gold-500"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          aria-hidden
        />
      )}

      <MethodIcon id={method.id} />

      <span className="min-w-0">
        <span className="block text-sm font-semibold text-parchment sm:text-base">{method.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-parchment-muted sm:text-xs">{method.hint}</span>
      </span>

      <span className="mt-auto inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald/10 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-normal text-emerald sm:text-[10px]">
        <Zap className="h-3 w-3" aria-hidden /> Instant Payment
      </span>

      <motion.span
        initial={false}
        animate={{ scale: selected ? 1 : 0, opacity: selected ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-gold-500 text-white shadow-md"
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </motion.span>
    </motion.button>
  );
});

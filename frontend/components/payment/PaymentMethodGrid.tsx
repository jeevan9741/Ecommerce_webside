"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { PaymentMethodCard } from "./PaymentMethodCard";
import { PAYMENT_METHODS, type PaymentMethodId } from "./payment-methods";

/**
 * ARIA radio group: one tab stop for the whole grid, arrow keys move and select
 * (matching native radio buttons), Home/End jump to the first/last method.
 */
export function PaymentMethodGrid({
  value,
  onChange,
}: {
  value: PaymentMethodId;
  onChange: (id: PaymentMethodId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, PAYMENT_METHODS.findIndex((m) => m.id === value));

  function focusAndSelect(index: number) {
    const next = (index + PAYMENT_METHODS.length) % PAYMENT_METHODS.length;
    onChange(PAYMENT_METHODS[next].id);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: PAYMENT_METHODS.length - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      focusAndSelect(keys[e.key]);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby="payment-method-heading"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
    >
      {PAYMENT_METHODS.map((method, i) => (
        <motion.div
          key={method.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 + i * 0.04, ease: "easeOut" }}
        >
          <PaymentMethodCard
            ref={(el) => {
              refs.current[i] = el;
            }}
            method={method}
            selected={method.id === value}
            tabIndex={i === selectedIndex ? 0 : -1}
            onSelect={() => onChange(method.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          />
        </motion.div>
      ))}
    </div>
  );
}

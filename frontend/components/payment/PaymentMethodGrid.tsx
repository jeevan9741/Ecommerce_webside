"use client";

import { motion } from "framer-motion";
import { PaymentMethodCard } from "./PaymentMethodCard";
import { PAYMENT_METHODS, type PaymentMethodId } from "./payment-methods";

/**
 * Each card is a pay button: one tap creates the order and opens Razorpay Checkout on that
 * method — no separate "select, then continue" step. `last` marks the method used most recently
 * (the one the big Pay button below also uses).
 */
export function PaymentMethodGrid({
  last,
  pending,
  disabled,
  onPay,
}: {
  last: PaymentMethodId;
  /** Method whose checkout is being prepared, if any. */
  pending: PaymentMethodId | null;
  disabled: boolean;
  onPay: (id: PaymentMethodId) => void;
}) {
  return (
    <ul aria-labelledby="payment-method-heading" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {PAYMENT_METHODS.map((method, i) => (
        <motion.li
          key={method.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 + i * 0.04, ease: "easeOut" }}
        >
          <PaymentMethodCard
            method={method}
            highlighted={method.id === last}
            pending={method.id === pending}
            disabled={disabled}
            onPay={() => onPay(method.id)}
          />
        </motion.li>
      ))}
    </ul>
  );
}

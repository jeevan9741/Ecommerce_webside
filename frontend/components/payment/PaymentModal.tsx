"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Lock, X } from "lucide-react";
import type { CoursePublic } from "@/components/course-card";
import { PaymentMethodGrid } from "./PaymentMethodGrid";
import { OrderSummary } from "./OrderSummary";
import { SecureCheckoutButton } from "./SecureCheckoutButton";
import { PAYMENT_METHODS, type PaymentMethodId } from "./payment-methods";

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PaymentModal({
  open,
  course,
  method,
  onMethodChange,
  onClose,
  onProceed,
  loading,
  error,
}: {
  open: boolean;
  course: CoursePublic;
  method: PaymentMethodId;
  onMethodChange: (id: PaymentMethodId) => void;
  onClose: () => void;
  onProceed: () => void;
  loading: boolean;
  error: string | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selected = PAYMENT_METHODS.find((m) => m.id === method) ?? PAYMENT_METHODS[0];

  // Focus the selected method on open; restore focus to the trigger on close; lock page scroll.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    }, 60);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  // Escape closes from anywhere — not only once focus has landed inside the dialog.
  useEffect(() => {
    if (!open || loading) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, loading, onClose]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    // Keep keyboard focus inside the dialog.
    const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4" onKeyDown={onKeyDown}>
          <motion.div
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={loading ? undefined : onClose}
            aria-hidden
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[28px] bg-gradient-to-br from-[#eef4ff] via-white to-[#f5f8ff] shadow-2xl sm:max-h-[90vh] sm:rounded-[28px]"
          >
            {/* Header */}
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-r from-gold-600 via-gold-500 to-gold-400 px-5 py-5 text-white sm:px-8">
              <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100">
                    <Lock className="h-3 w-3" aria-hidden /> Secure checkout
                  </p>
                  <h2 id="payment-modal-title" className="mt-1 font-display text-xl font-semibold sm:text-2xl">
                    Complete your enrolment
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  aria-label="Close payment"
                  className="-mr-1 rounded-full p-2 text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-40"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_320px] lg:gap-6">
                <div className="min-w-0">
                  <div className="mb-4 flex items-baseline justify-between gap-3">
                    <h3 id="payment-method-heading" className="text-base font-semibold text-parchment sm:text-lg">
                      Choose payment method
                    </h3>
                    <span className="text-xs text-parchment-muted">Step 1 of 2</span>
                  </div>
                  <PaymentMethodGrid value={method} onChange={onMethodChange} />

                  {error && (
                    <motion.p
                      role="alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-5 flex items-start gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {error}
                    </motion.p>
                  )}
                </div>

                <aside className="lg:sticky lg:top-0 lg:self-start">
                  <OrderSummary course={course} />
                  {/* Desktop keeps the button with the summary; mobile gets a sticky footer below. */}
                  <div className="mt-5 hidden lg:block">
                    <SecureCheckoutButton
                      amountInPaise={course.priceInPaise}
                      methodLabel={selected.label}
                      loading={loading}
                      onClick={onProceed}
                    />
                  </div>
                </aside>
              </div>
            </div>

            {/* Sticky footer (mobile + tablet) */}
            <div className="shrink-0 border-t border-border-soft bg-white/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-xl lg:hidden">
              <SecureCheckoutButton
                amountInPaise={course.priceInPaise}
                methodLabel={selected.label}
                loading={loading}
                onClick={onProceed}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

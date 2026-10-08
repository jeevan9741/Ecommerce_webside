"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileText, Loader2, Mail, RefreshCw, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { backendFetch } from "@/lib/api";
import { formatDateTime, formatInr } from "@/lib/format";
import { BrandLogo } from "@/components/logo";
import { createCheckoutOrder, loadRazorpay, openCheckout } from "@/lib/checkout";

export interface OrderDetails {
  id: string;
  status: "CREATED" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
  amountInPaise: number;
  selectedLanguage: string | null;
  createdAt: string;
  paidAt: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  invoiceNumber: string | null;
  course: { id: string; title: string; type: string; priceInPaise: number };
  customer: { name: string; email: string; phone: string | null };
}

type View = "loading" | "success" | "pending" | "stalled" | "failed" | "closed" | "missing";

const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;
/** Ask Razorpay directly at these points — covers a late or missed webhook. */
const SYNC_AT_MS = [0, 15_000, 40_000];

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchOrder(id: string): Promise<OrderDetails | null> {
  const res = await backendFetch(`/api/orders/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()).order as OrderDetails;
}

export function PaymentResult({ orderId, failedHint }: { orderId: string; failedHint: string | null }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [view, setView] = useState<View>("loading");
  const [failure, setFailure] = useState<string | null>(failedHint);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const pollToken = useRef(0);

  const settle = useCallback(
    (o: OrderDetails, declined: string | null) => {
      setOrder(o);
      if (o.status === "PAID") {
        setView("success");
        router.refresh(); // the dashboard guard re-reads purchases on the next navigation
      } else if (o.status === "REFUNDED" || o.status === "CANCELLED") setView("closed");
      else if (o.status === "FAILED" || declined) setView("failed");
      else setView("pending");
    },
    [router]
  );

  /** Pending → poll our status and ask Razorpay a few times, until paid or the time limit. */
  const confirm = useCallback(async () => {
    const token = ++pollToken.current;
    setView("pending");
    const started = Date.now();
    const syncs = [...SYNC_AT_MS];
    while (pollToken.current === token && Date.now() - started < POLL_LIMIT_MS) {
      if (syncs.length && Date.now() - started >= syncs[0]) {
        syncs.shift();
        await backendFetch(`/api/orders/${orderId}/sync`, { method: "POST" }).catch(() => undefined);
      }
      const o = await fetchOrder(orderId).catch(() => null);
      if (pollToken.current !== token) return;
      if (o && o.status !== "CREATED") return settle(o, null);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (pollToken.current === token) setView("stalled");
  }, [orderId, settle]);

  useEffect(() => {
    let cancelled = false;
    fetchOrder(orderId)
      .then((o) => {
        if (cancelled) return;
        if (!o) return setView("missing");
        if (o.status === "CREATED" && !failedHint) {
          setOrder(o);
          void confirm();
        } else settle(o, failedHint);
      })
      .catch(() => !cancelled && setView("missing"));
    return () => {
      cancelled = true;
      // A counter, not a DOM ref: bumping it cancels any poll still running for this order.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pollToken.current++;
    };
  }, [orderId, failedHint, confirm, settle]);

  async function retry() {
    if (!order || retrying) return;
    setRetrying(true);
    setRetryError(null);
    const [loaded, result] = await Promise.all([
      loadRazorpay().then(() => true, () => false),
      createCheckoutOrder({ courseId: order.course.id, selectedLanguage: order.selectedLanguage ?? undefined, referralCode: getCookie("eca_ref") }),
    ]);
    if (result.kind === "already-purchased") {
      setRetrying(false);
      if (result.orderId && result.orderId !== orderId) return router.push(`/payment/${result.orderId}`);
      return void confirm();
    }
    if (result.kind === "error" || !loaded) {
      setRetrying(false);
      return setRetryError(result.kind === "error" ? result.message : "Couldn't reach the payment service — please check your connection.");
    }
    const { order: checkoutOrder } = result;
    openCheckout({
      order: checkoutOrder,
      customer: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone },
      onSuccess: () => {
        setRetrying(false);
        setFailure(null);
        if (checkoutOrder.orderId !== orderId) return router.replace(`/payment/${checkoutOrder.orderId}`);
        if (failedHint) window.history.replaceState(null, "", `/payment/${orderId}`); // drop the stale ?status=failed
        void confirm();
      },
      onDismiss: (declined) => {
        setRetrying(false);
        if (declined) setFailure(declined);
      },
    });
  }

  return (
    <div className="container-academy flex justify-center py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-border-soft bg-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)]"
      >
        <div className="relative overflow-hidden bg-gradient-to-r from-gold-600 via-gold-500 to-gold-400 px-6 py-5 text-white">
          <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3">
            <span className="shrink-0 rounded-full bg-white/95 p-1 shadow-lg">
              <BrandLogo className="h-11 w-11" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100">E-Commerce Training Academy</p>
              <p className="font-display text-lg font-semibold">Payment status</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-10" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
              {view === "loading" && <Status icon={<Loader2 className="h-10 w-10 animate-spin text-gold-500" />} title="Loading your order…" />}

              {view === "pending" && (
                <Status
                  icon={<PulseRing><Loader2 className="h-10 w-10 animate-spin text-gold-500" /></PulseRing>}
                  title="Confirming your payment"
                  body="We're confirming the payment with your bank. UPI payments can take up to a minute — please keep this page open."
                />
              )}

              {view === "stalled" && order && (
                <>
                  <Status
                    icon={<Clock3 className="h-12 w-12 text-gold-500" />}
                    title="Payment pending"
                    body="Your bank hasn't confirmed this payment yet. If money was debited, your course unlocks automatically as soon as it's confirmed — usually within a few minutes. You won't be charged twice."
                  />
                  <Summary order={order} />
                  <Actions>
                    <button onClick={() => void confirm()} className="btn-gold w-full sm:w-auto">
                      <RefreshCw className="h-4 w-4" /> Check again
                    </button>
                    <button onClick={retry} disabled={retrying} className="btn-outline w-full sm:w-auto">
                      {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Pay now
                    </button>
                  </Actions>
                </>
              )}

              {view === "success" && order && (
                <>
                  <Status
                    icon={
                      <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
                        <PulseRing tone="emerald"><CheckCircle2 className="h-14 w-14 text-emerald" /></PulseRing>
                      </motion.span>
                    }
                    title="Payment successful"
                    body={`Welcome to ${order.course.title}! Your course is unlocked and ready.`}
                  />
                  <Summary order={order} />
                  <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-parchment-muted">
                    <Mail className="h-3.5 w-3.5" aria-hidden /> A confirmation with your invoice is on its way to {order.customer.email}.
                  </p>
                  <Actions>
                    <Link href="/dashboard/courses" className="btn-gold w-full sm:w-auto">
                      Start learning <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href={`/invoice/${order.id}`} className="btn-outline w-full sm:w-auto">
                      <FileText className="h-4 w-4" /> View invoice
                    </Link>
                  </Actions>
                </>
              )}

              {view === "failed" && order && (
                <>
                  <Status
                    icon={<XCircle className="h-14 w-14 text-danger" />}
                    title="Payment failed"
                    body={`${failureMessage(failure)} No money was taken for this attempt — if your bank shows a debit, it's reversed automatically.`}
                  />
                  <Summary order={order} />
                  <Actions>
                    <button onClick={retry} disabled={retrying} className="btn-gold w-full sm:w-auto">
                      {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Retry payment
                    </button>
                    <Link href="/courses" className="btn-outline w-full sm:w-auto">
                      Choose another method
                    </Link>
                  </Actions>
                </>
              )}

              {view === "closed" && order && (
                <>
                  <Status
                    icon={<AlertTriangle className="h-12 w-12 text-parchment-muted" />}
                    title={order.status === "REFUNDED" ? "Payment refunded" : "Order cancelled"}
                    body={order.status === "REFUNDED" ? "This payment was refunded, so the course is no longer active on your account." : "This order was cancelled."}
                  />
                  <Summary order={order} />
                  <Actions>
                    <Link href="/courses" className="btn-gold w-full sm:w-auto">Browse courses</Link>
                  </Actions>
                </>
              )}

              {view === "missing" && (
                <>
                  <Status icon={<AlertTriangle className="h-12 w-12 text-parchment-muted" />} title="Order not found" body="We couldn't find this order on your account. Make sure you're signed in with the account you paid from." />
                  <Actions>
                    <Link href="/courses" className="btn-gold w-full sm:w-auto">Go to courses</Link>
                  </Actions>
                </>
              )}

              {retryError && <p role="alert" className="mt-4 text-center text-sm text-danger">{retryError}</p>}
            </motion.div>
          </AnimatePresence>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] text-parchment-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald" aria-hidden /> Payments are processed securely by Razorpay. Courses unlock only after the payment is confirmed.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

/** Razorpay's decline reason as a sentence; its generic "Payment failed" would just repeat the title. */
function failureMessage(reason: string | null) {
  const text = (reason ?? "").trim();
  if (!text || /^payment (failed|was declined)\.?$/i.test(text)) return "Your payment didn't go through.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function Status({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-24 items-center justify-center">{icon}</div>
      <h1 className="mt-2 font-display text-2xl font-semibold text-parchment sm:text-3xl">{title}</h1>
      {body && <p className="mt-2 max-w-md text-sm leading-relaxed text-parchment-muted">{body}</p>}
    </div>
  );
}

function PulseRing({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "emerald" }) {
  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      <span className={`absolute inset-0 animate-ping rounded-full opacity-30 ${tone === "emerald" ? "bg-emerald/40" : "bg-gold-500/30"}`} aria-hidden />
      <span className={`absolute inset-1 rounded-full ${tone === "emerald" ? "bg-emerald/10" : "bg-gold-100"}`} aria-hidden />
      <span className="relative">{children}</span>
    </span>
  );
}

function Summary({ order }: { order: OrderDetails }) {
  const rows: [string, string][] = [
    ["Course", order.course.title],
    ["Amount", formatInr(order.amountInPaise)],
    ...(order.invoiceNumber ? ([["Invoice no.", order.invoiceNumber]] as [string, string][]) : []),
    ...(order.razorpayPaymentId ? ([["Payment ID", order.razorpayPaymentId]] as [string, string][]) : []),
    ["Date", formatDateTime(order.paidAt ?? order.createdAt)],
  ];
  return (
    <dl className="mt-6 divide-y divide-border-soft rounded-2xl border border-border-soft bg-ink/60 px-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="text-parchment-muted">{k}</dt>
          <dd className="min-w-0 break-all text-right font-medium text-parchment">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">{children}</div>;
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import type { CoursePublic } from "@/components/course-card";
import { PaymentModal } from "@/components/payment/PaymentModal";
import { PAYMENT_METHODS, buildCheckoutConfig, type PaymentMethodId } from "@/components/payment/payment-methods";
import { createCheckoutOrder, loadRazorpay, openCheckout, paymentPageUrl } from "@/lib/checkout";
import { userService } from "@/services/userService";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function BuyCourseButton({
  course,
  alreadyPurchased = false,
}: {
  course: CoursePublic;
  alreadyPurchased?: boolean;
}) {
  const { user, status } = useAuth();
  const router = useRouter();
  // The backend requires a language for multi-language courses. It only sets the course
  // player's starting language — every language stays switchable after purchase.
  const language = course.languages[0]?.code ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethodId>("upi");
  // Razorpay only honours prefill.method when a phone number is also prefilled.
  const [contact, setContact] = useState<string | null>(null);
  // A ref guard is synchronous, unlike React state — it closes the window between
  // a click and the next render where a second click could otherwise slip through.
  const inFlightRef = useRef(false);

  if (alreadyPurchased) {
    return (
      <button
        onClick={() => router.push("/dashboard/courses")}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald bg-emerald/10 px-6 py-4 text-base font-semibold text-emerald transition hover:bg-emerald/15"
      >
        <CheckCircle2 className="h-4 w-4" /> Go to Course
      </button>
    );
  }

  // Still confirming the stored session — don't offer "Login" to someone who is already signed in.
  if (status === "loading") {
    return (
      <button disabled aria-busy="true" className="btn-gold w-full py-4 text-base opacity-70">
        <Loader2 className="h-4 w-4 animate-spin" />
      </button>
    );
  }

  if (status !== "authenticated") {
    return (
      <button onClick={() => router.push(`/login?callbackUrl=/courses`)} className="btn-outline w-full py-4 text-base">
        <Lock className="h-4 w-4" /> Login to Purchase
      </button>
    );
  }

  function release() {
    setBusy(false);
    inFlightRef.current = false;
  }

  // One tap → one order (the backend reuses an open one) → Razorpay opens on that method. The
  // method is passed in rather than read from state so a tap doesn't race the setMethod() render.
  async function handleBuy(methodId: PaymentMethodId) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setMethod(methodId);
    setError(null);
    setBusy(true);

    const [loaded, result] = await Promise.all([
      loadRazorpay().then(() => true, () => false),
      createCheckoutOrder({ courseId: course.id, selectedLanguage: language, referralCode: getCookie("eca_ref") }),
    ]);

    if (result.kind === "already-purchased") {
      router.push(result.orderId ? paymentPageUrl(result.orderId) : "/dashboard/courses");
      return;
    }
    if (result.kind === "error") {
      setError(result.message);
      return release();
    }
    if (!loaded) {
      setError("Couldn't reach the payment service — please check your connection and try again.");
      return release();
    }

    const selected = PAYMENT_METHODS.find((m) => m.id === methodId) ?? PAYMENT_METHODS[0];
    const { order } = result;
    try {
      openCheckout({
        order,
        customer: { name: user?.name, email: user?.email, contact },
        method: { prefillMethod: selected.prefillMethod, config: buildCheckoutConfig(selected) },
        onSuccess: () => router.push(paymentPageUrl(order.orderId)),
        onDismiss: (failure) => {
          release();
          if (failure) {
            // A declined attempt: the payment page explains it and offers a retry on the same order.
            router.push(paymentPageUrl(order.orderId, failure));
          } else {
            // Closed without paying — back to our picker so they can try another method.
            setModalOpen(true);
          }
        },
      });
      setModalOpen(false);
      // busy stays set while Checkout is open — it clears via onSuccess navigation or onDismiss,
      // so a tap on the (hidden) button underneath can't start a second checkout.
    } catch {
      setError("Payment service is temporarily unavailable. Please try again shortly.");
      release();
    }
  }

  function openPicker() {
    setError(null);
    setModalOpen(true);
    // Warm up checkout.js while the customer picks a method.
    void loadRazorpay().catch(() => undefined);
    if (contact === null) {
      // Best effort: without a phone number Checkout still opens on the chosen method
      // (via config.display); it just can't also pre-select it.
      userService
        .getMe()
        .then(({ user: me }) => setContact(typeof me.phone === "string" ? me.phone : ""))
        .catch(() => setContact(""));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={openPicker}
        onPointerEnter={() => void loadRazorpay().catch(() => undefined)}
        disabled={busy}
        className="btn-gold w-full bg-gradient-to-r from-gold-500 to-gold-600 py-4 text-base shadow-[0_12px_28px_-10px_rgba(37,99,235,0.65)] hover:-translate-y-0.5 hover:from-gold-hover hover:to-gold-500"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enroll Now"}
      </button>
      {error && !modalOpen && <p className="text-xs text-danger">{error}</p>}

      <PaymentModal
        open={modalOpen}
        course={course}
        method={method}
        onClose={() => setModalOpen(false)}
        onPay={handleBuy}
        loading={busy}
        error={error}
      />
    </div>
  );
}

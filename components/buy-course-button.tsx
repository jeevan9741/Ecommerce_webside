"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import type { CoursePublic } from "@/components/course-card";
import { LanguageSelector } from "@/components/language-selector";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const LOG_PREFIX = "[PAYMENT]";

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
  const { data: session, status } = useSession();
  const router = useRouter();
  const [language, setLanguage] = useState(course.languages[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // A ref guard is synchronous, unlike React state — it closes the window between
  // a click and the next render where a second click could otherwise slip through.
  const inFlightRef = useRef(false);

  if (alreadyPurchased) {
    return (
      <button
        onClick={() => router.push("/dashboard")}
        className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald bg-emerald/10 px-6 py-3 text-sm font-semibold text-emerald transition hover:bg-emerald/15"
      >
        <CheckCircle2 className="h-4 w-4" /> Go to Course
      </button>
    );
  }

  if (status !== "authenticated") {
    return (
      <button
        onClick={() => router.push(`/login?callbackUrl=/courses`)}
        className="btn-outline w-full"
      >
        <Lock className="h-4 w-4" /> Login to Purchase
      </button>
    );
  }

  async function pollOrderStatus(orderId: string) {
    console.log(`${LOG_PREFIX} polling order status`, { orderId });
    setProcessing(true);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/orders/${orderId}/status`);
      if (res.ok) {
        const data = await res.json();
        console.log(`${LOG_PREFIX} order status`, data.status);
        if (data.status === "PAID") {
          inFlightRef.current = false;
          router.push("/dashboard");
          return;
        }
        if (data.status === "FAILED") {
          inFlightRef.current = false;
          setProcessing(false);
          setError("Payment failed. Please try again.");
          return;
        }
      }
    }

    // The webhook hasn't landed within ~22s (missed delivery, misconfiguration, etc.) —
    // ask Razorpay directly, once, before giving up. Same unlock path, just a different trigger.
    console.log(`${LOG_PREFIX} poll timed out — attempting self-heal via direct Razorpay check`, { orderId });
    try {
      const syncRes = await fetch(`/api/orders/${orderId}/sync`, { method: "POST" });
      const syncData = await syncRes.json().catch(() => ({}));
      console.log(`${LOG_PREFIX} self-heal result`, syncData);
      if (syncData.synced || syncData.alreadyPaid) {
        inFlightRef.current = false;
        router.push("/dashboard");
        return;
      }
    } catch (e) {
      console.error(`${LOG_PREFIX} self-heal check failed`, e);
    }

    inFlightRef.current = false;
    setProcessing(false);
    setError(
      "Your payment is being confirmed — this can take a minute. Check your Activity page shortly; contact support if it doesn't appear."
    );
    router.push("/dashboard/activity");
  }

  async function handleBuy() {
    if (inFlightRef.current) {
      console.log(`${LOG_PREFIX} ignored duplicate click — checkout already in progress`);
      return;
    }
    inFlightRef.current = true;
    setError(null);
    setBusy(true);
    console.log(`${LOG_PREFIX} starting checkout`, { courseId: course.id, language });

    if (typeof window.Razorpay !== "function") {
      console.error(`${LOG_PREFIX} Razorpay checkout script has not loaded yet`);
      setError("Payment service is still loading — please wait a moment and try again.");
      setBusy(false);
      inFlightRef.current = false;
      return;
    }

    let data: { orderId?: string; razorpayOrderId?: string; amountInPaise?: number; currency?: string; keyId?: string; courseName?: string; error?: string; code?: string };
    try {
      const referralCode = getCookie("eca_ref");
      const res = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          selectedLanguage: language || undefined,
          referralCode: referralCode || undefined,
        }),
      });
      data = await res.json().catch(() => ({}));
      console.log(`${LOG_PREFIX} create-order response`, { status: res.status, code: data.code });
      if (!res.ok) throw new Error(data.error ?? "Order creation failed — please try again.");
    } catch (e) {
      const message =
        e instanceof TypeError
          ? "Network error — please check your internet connection and try again."
          : e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.";
      console.error(`${LOG_PREFIX} create-order failed`, e);
      setError(message);
      setBusy(false);
      inFlightRef.current = false;
      return;
    }

    try {
      const rzp = new window.Razorpay({
        key: data.keyId,
        amount: data.amountInPaise,
        currency: data.currency,
        order_id: data.razorpayOrderId,
        name: "E-Commerce Training Academy",
        description: data.courseName,
        prefill: { name: session?.user?.name ?? "", email: session?.user?.email ?? "" },
        theme: { color: "#2563eb" },
        handler: () => {
          console.log(`${LOG_PREFIX} payment handler fired`, { orderId: data.orderId });
          pollOrderStatus(data.orderId!);
        },
        modal: {
          ondismiss: () => {
            console.log(`${LOG_PREFIX} checkout modal dismissed by user`);
            setBusy(false);
            inFlightRef.current = false;
          },
        },
      });
      rzp.open();
      console.log(`${LOG_PREFIX} Razorpay checkout opened`, { razorpayOrderId: data.razorpayOrderId });
      // Deliberately leave `busy`/inFlightRef set while the modal is open — it only
      // clears via the payment handler or ondismiss above, so a click on the
      // (visually hidden) button underneath the modal can't fire a second order.
    } catch (e) {
      console.error(`${LOG_PREFIX} failed to open Razorpay checkout`, e);
      setError("Payment service is temporarily unavailable. Please try again shortly.");
      setBusy(false);
      inFlightRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {course.languages.length > 0 && (
        <LanguageSelector languages={course.languages} value={language} onChange={setLanguage} />
      )}
      <button onClick={handleBuy} disabled={busy || processing} className="btn-gold w-full">
        {busy || processing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enroll Now"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

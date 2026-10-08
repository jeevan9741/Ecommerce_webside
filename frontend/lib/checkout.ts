/**
 * Razorpay Checkout, shared by the Buy button and the Retry button on the payment page.
 *
 * Trust model: nothing the browser reports unlocks a course. The backend grants access only after
 * Razorpay confirms a captured payment for this order (webhook, or the server-side /sync check).
 * The success payload is still forwarded so its signature is verified as an extra tripwire.
 */
import { backendFetch } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open: () => void;
  on: (event: "payment.failed", cb: (resp: { error?: { description?: string; reason?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loader: Promise<void> | null = null;

/** Loads checkout.js once. Started early (on intent), so a tap on a phone never waits for it. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (typeof window.Razorpay === "function") return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => (typeof window.Razorpay === "function" ? resolve() : reject(new Error("Razorpay failed to load")));
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error("Razorpay failed to load")), { once: true });
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.head.appendChild(script);
    } else if (typeof window.Razorpay === "function") {
      resolve();
    }
  }).catch((err) => {
    loader = null; // allow a retry after a network blip
    throw err;
  });
  return loader;
}

export interface CheckoutOrder {
  orderId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  keyId: string;
  courseName: string;
}

export type CreateOrderResult =
  | { kind: "order"; order: CheckoutOrder }
  | { kind: "already-purchased"; orderId?: string }
  | { kind: "error"; message: string };

export async function createCheckoutOrder(input: { courseId: string; selectedLanguage?: string; referralCode?: string | null }): Promise<CreateOrderResult> {
  try {
    const res = await backendFetch("/api/checkout/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: input.courseId,
        selectedLanguage: input.selectedLanguage || undefined,
        referralCode: input.referralCode || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.code === "ALREADY_PURCHASED") return { kind: "already-purchased", orderId: data.orderId };
    if (!res.ok) return { kind: "error", message: data.error ?? "Order creation failed — please try again." };
    return { kind: "order", order: data as CheckoutOrder };
  } catch {
    return { kind: "error", message: "Network error — please check your internet connection and try again." };
  }
}

export interface OpenCheckoutOptions {
  order: CheckoutOrder;
  customer: { name?: string; email?: string; contact?: string | null };
  /** Razorpay `prefill.method` and `config` narrowing to one method; omit to offer every method. */
  method?: { prefillMethod: string; config: Record<string, unknown> };
  /** Checkout reported success — confirmation happens on the payment page. */
  onSuccess: () => void;
  /** Closed without paying. `failure` is the last decline reason, if a payment attempt failed. */
  onDismiss: (failure: string | null) => void;
}

export function openCheckout({ order, customer, method, onSuccess, onDismiss }: OpenCheckoutOptions) {
  let lastFailure: string | null = null;
  const rzp = new window.Razorpay({
    key: order.keyId,
    amount: order.amountInPaise,
    currency: order.currency,
    order_id: order.razorpayOrderId,
    name: "E-Commerce Training Academy",
    description: order.courseName,
    // Shown in Checkout's header. Absolute URL; Razorpay fetches it from its own domain.
    image: `${SITE_URL}/brand/eta-logo-email.png`,
    prefill: {
      name: customer.name ?? "",
      email: customer.email ?? "",
      // Razorpay only applies prefill.method when contact and email are both set.
      ...(customer.contact ? { contact: customer.contact, ...(method ? { method: method.prefillMethod } : {}) } : {}),
    },
    ...(method ? { config: method.config } : {}),
    notes: { orderId: order.orderId },
    theme: { color: "#2563eb", backdrop_color: "rgba(15, 23, 42, 0.6)" },
    // Declined attempts stay inside Checkout so the customer can try again without a new order.
    retry: { enabled: true, max_count: 4 },
    handler: (resp: { razorpay_payment_id?: string; razorpay_signature?: string }) => {
      // Fire-and-forget: the payment page polls and re-checks with Razorpay regardless.
      void backendFetch(`/api/orders/${order.orderId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature }),
      }).catch(() => undefined);
      onSuccess();
    },
    modal: {
      ondismiss: () => onDismiss(lastFailure),
      // Ask before abandoning mid-payment (e.g. while a UPI app is open).
      confirm_close: true,
    },
  });
  rzp.on("payment.failed", (resp) => {
    lastFailure = resp.error?.description || resp.error?.reason || "The payment was declined.";
  });
  rzp.open();
}

export function paymentPageUrl(orderId: string, failure?: string | null) {
  return failure ? `/payment/${orderId}?status=failed&reason=${encodeURIComponent(failure.slice(0, 200))}` : `/payment/${orderId}`;
}

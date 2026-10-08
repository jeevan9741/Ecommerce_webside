import type { Metadata } from "next";
import { PaymentResult } from "@/components/payment/PaymentResult";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/** Outcome of a checkout: success, pending (confirms with Razorpay), failed (with retry), refunded. */
export default async function PaymentPage({ params, searchParams }: PageProps<"/payment/[orderId]">) {
  const { orderId } = await params;
  const { status, reason } = await searchParams;
  const failedHint = status === "failed" ? (typeof reason === "string" && reason ? reason : "The payment was declined.") : null;
  return <PaymentResult key={orderId} orderId={orderId} failedHint={failedHint} />;
}

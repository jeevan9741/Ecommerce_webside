import type { Metadata } from "next";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/session";
import { formatDateTime, formatInr, COURSE_TYPE_LABEL } from "@/lib/format";
import { SITE_URL } from "@/lib/site";
import { LOGO_SRC } from "@/components/logo";
import { PrintButton } from "@/components/payment/PrintButton";
import type { OrderDetails } from "@/components/payment/PaymentResult";

export const metadata: Metadata = { title: "Invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Printable invoice / payment receipt for a paid order. "Save as PDF" in the print dialog downloads it. */
export default async function InvoicePage({ params }: PageProps<"/invoice/[orderId]">) {
  const { orderId } = await params;
  const order = await serverApi<{ order: OrderDetails }>(`/orders/${orderId}`)
    .then((r) => r.order)
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    });

  if (!order || !order.invoiceNumber) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-semibold">Invoice not available</h1>
        <p className="mt-2 text-sm text-parchment-muted">An invoice is issued once a payment is confirmed.</p>
        <Link href={order ? `/payment/${order.id}` : "/courses"} className="btn-gold mt-6">
          {order ? "View payment status" : "Go to courses"}
        </Link>
      </main>
    );
  }

  const site = new URL(SITE_URL).host;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 print:max-w-none print:p-0 sm:py-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/payment/${order.id}`} className="btn-ghost">← Back</Link>
        <PrintButton />
      </div>

      <article className="rounded-[24px] border border-border-soft bg-white p-6 shadow-sm print:rounded-none print:border-0 print:shadow-none sm:p-10">
        <header className="flex flex-col gap-6 border-b border-border-soft pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- printed document; plain img prints reliably */}
            <img src={LOGO_SRC} alt="" width={72} height={72} className="h-[72px] w-[72px]" />
            <div>
              <p className="font-display text-xl font-semibold text-parchment">E-Commerce Training Academy</p>
              <p className="text-sm text-parchment-muted">{site}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-500">Invoice / Receipt</p>
            <p className="mt-1 font-mono text-base font-semibold text-parchment">{order.invoiceNumber}</p>
            <p className="mt-1 text-sm text-parchment-muted">Date: {formatDateTime(order.paidAt ?? order.createdAt)}</p>
            {order.status === "REFUNDED" && <p className="mt-1 text-sm font-semibold text-danger">REFUNDED</p>}
          </div>
        </header>

        <section className="grid gap-6 border-b border-border-soft py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">Billed to</p>
            <p className="mt-1 font-semibold text-parchment">{order.customer.name}</p>
            <p className="text-sm text-parchment-muted">{order.customer.email}</p>
            {order.customer.phone && <p className="text-sm text-parchment-muted">{order.customer.phone}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">Payment</p>
            <p className="mt-1 text-sm text-parchment">Paid online via Razorpay</p>
            <p className="break-all text-sm text-parchment-muted">Payment ID: {order.razorpayPaymentId}</p>
            <p className="break-all text-sm text-parchment-muted">Order ID: {order.razorpayOrderId}</p>
          </div>
        </section>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-border-soft text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="pb-2 font-semibold">Description</th>
              <th className="pb-2 text-right font-semibold">Qty</th>
              <th className="pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border-soft">
              <td className="py-3 pr-4">
                <p className="font-medium text-parchment">{order.course.title}</p>
                <p className="text-xs text-parchment-muted">
                  {COURSE_TYPE_LABEL[order.course.type] ?? order.course.type}
                  {order.selectedLanguage ? ` · ${order.selectedLanguage.toUpperCase()}` : ""}
                </p>
              </td>
              <td className="py-3 text-right text-parchment">1</td>
              <td className="py-3 text-right text-parchment">{formatInr(order.amountInPaise)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-4 text-right font-semibold text-parchment">Total paid</td>
              <td className="pt-4 text-right text-lg font-bold text-parchment">{formatInr(order.amountInPaise)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="pt-1 text-right text-xs text-parchment-muted">Inclusive of all applicable taxes</td>
            </tr>
          </tfoot>
        </table>

        <footer className="mt-10 border-t border-border-soft pt-4 text-center text-xs text-parchment-muted">
          Thank you for learning with E-Commerce Training Academy. This is a computer-generated document and needs no signature.
        </footer>
      </article>
    </main>
  );
}

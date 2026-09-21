"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { formatInr, formatDateTime } from "@/lib/format";

interface AdminOrder {
  id: string;
  courseTitle: string;
  customerName: string;
  customerEmail: string;
  amountInPaise: number;
  status: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  hasAccess: boolean;
  createdAt: string;
  paidAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-emerald/15 text-emerald border-emerald/40",
  CREATED: "bg-gold-500/15 text-gold-400 border-gold-500/40",
  FAILED: "bg-danger/15 text-danger border-danger/40",
  REFUNDED: "bg-parchment-muted/15 text-parchment-muted border-border-strong",
  CANCELLED: "bg-parchment-muted/15 text-parchment-muted border-border-strong",
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const data = await backendFetch("/api/admin/orders").then((r) => r.json());
    setOrders(data.orders ?? []);
  }

  useEffect(() => {
    backendFetch("/api/admin/orders")
      .then((r) => r.json())
      .then((data) => setOrders(data.orders ?? []));
  }, []);

  async function sync(orderId: string) {
    setSyncingId(orderId);
    setMessage(null);
    try {
      const res = await backendFetch(`/api/admin/orders/${orderId}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Sync failed");
      } else if (data.synced) {
        setMessage("Payment confirmed on Razorpay — course access granted.");
      } else if (data.alreadyPaid) {
        setMessage("This order is already marked as paid.");
      } else {
        setMessage(data.reason ?? "No captured payment found yet on Razorpay for this order.");
      }
      await load();
    } finally {
      setSyncingId(null);
    }
  }

  if (!orders) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Orders</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Every order should move from CREATED → PAID automatically via the Razorpay webhook. If one is
          stuck on CREATED despite a captured payment in the Razorpay Dashboard, use{" "}
          <span className="text-parchment">Sync</span> to check directly with Razorpay and grant access.
        </p>
      </div>

      {message && (
        <p className="mt-4 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-parchment">
          {message}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[950px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Course</th>
              <th className="px-4 pb-2">Customer</th>
              <th className="px-4 pb-2">Amount</th>
              <th className="px-4 pb-2">Status</th>
              <th className="px-4 pb-2">Access</th>
              <th className="px-4 pb-2">Razorpay Order</th>
              <th className="px-4 pb-2">Date</th>
              <th className="px-4 pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="card align-top">
                <td className="rounded-l-2xl px-4 py-3 text-parchment">{o.courseTitle}</td>
                <td className="px-4 py-3 text-parchment-muted">
                  {o.customerName}
                  <span className="block text-xs">{o.customerEmail}</span>
                </td>
                <td className="px-4 py-3 text-parchment">{formatInr(o.amountInPaise)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[o.status]}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${o.hasAccess ? "text-emerald" : "text-parchment-muted"}`}>
                    {o.hasAccess ? "Granted" : "None"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-parchment-muted">
                  {o.razorpayOrderId}
                  {o.razorpayPaymentId && <span className="block">{o.razorpayPaymentId}</span>}
                </td>
                <td className="px-4 py-3 text-parchment-muted">{formatDateTime(o.createdAt)}</td>
                <td className="rounded-r-2xl px-4 py-3">
                  {o.status !== "PAID" && (
                    <button
                      onClick={() => sync(o.id)}
                      disabled={syncingId === o.id}
                      className="btn-ghost !px-2 !py-1.5 text-xs"
                      title="Check Razorpay and grant access if captured"
                    >
                      {syncingId === o.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Sync
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-parchment-muted">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

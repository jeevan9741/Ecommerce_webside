"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatDate, formatInr } from "@/lib/format";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  referralCode: string;
  emailVerified: string | null;
  createdAt: string;
  orders: { amountInPaise: number; createdAt: string; referralCodeUsed: string | null; course: { title: string } }[];
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);

  useEffect(() => {
    backendFetch("/api/admin/customers").then((r) => r.json()).then((d) => setCustomers(d.customers));
  }, []);

  if (!customers) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Customers</h1>
      <p className="mt-1 text-sm text-parchment-muted">{customers.length} registered customers</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[800px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Name</th>
              <th className="px-4 pb-2">Contact</th>
              <th className="px-4 pb-2">Purchases</th>
              <th className="px-4 pb-2">Total Spent</th>
              <th className="px-4 pb-2">Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="card align-top">
                <td className="rounded-l-2xl px-4 py-3">
                  <p className="text-parchment">{c.name}</p>
                  <p className="text-xs text-parchment-muted">{c.emailVerified ? "Verified" : "Unverified"}</p>
                </td>
                <td className="px-4 py-3 text-parchment-muted">
                  <p>{c.email}</p>
                  <p>{c.phone}</p>
                </td>
                <td className="px-4 py-3 text-parchment-muted">
                  {c.orders.length === 0 ? "—" : c.orders.map((o) => o.course.title).join(", ")}
                </td>
                <td className="px-4 py-3 text-parchment">
                  {formatInr(c.orders.reduce((sum, o) => sum + o.amountInPaise, 0))}
                </td>
                <td className="rounded-r-2xl px-4 py-3 text-parchment-muted">{formatDate(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

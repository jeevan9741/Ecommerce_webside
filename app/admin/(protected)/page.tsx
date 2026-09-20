"use client";

import { useEffect, useState } from "react";
import { Loader2, IndianRupee, CalendarDays, CalendarRange, TrendingUp, Wallet, CheckCircle2, XCircle, Clock } from "lucide-react";
import { formatInr } from "@/lib/format";

interface SalesData {
  today: { amountInPaise: number; count: number };
  week: { amountInPaise: number; count: number };
  month: { amountInPaise: number; count: number };
  total: { amountInPaise: number; count: number };
  byCourse: { courseId: string; title: string; type: string; amountInPaise: number; count: number }[];
}
interface PayoutData {
  todayPayoutsInPaise: number;
  totalPaidInPaise: number;
  pendingInPaise: number;
  pendingCount: number;
  successCount: number;
  failedCount: number;
}

export default function AdminOverviewPage() {
  const [sales, setSales] = useState<SalesData | null>(null);
  const [payouts, setPayouts] = useState<PayoutData | null>(null);

  useEffect(() => {
    fetch("/api/admin/analytics/sales").then((r) => r.json()).then(setSales);
    fetch("/api/admin/analytics/payouts").then((r) => r.json()).then(setPayouts);
  }, []);

  if (!sales || !payouts) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Sales Overview</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={CalendarDays} label="Today's Sales" value={formatInr(sales.today.amountInPaise)} sub={`${sales.today.count} orders`} />
        <Stat icon={CalendarRange} label="Weekly Sales" value={formatInr(sales.week.amountInPaise)} sub={`${sales.week.count} orders`} />
        <Stat icon={TrendingUp} label="Monthly Sales" value={formatInr(sales.month.amountInPaise)} sub={`${sales.month.count} orders`} />
        <Stat icon={IndianRupee} label="Total Revenue" value={formatInr(sales.total.amountInPaise)} sub={`${sales.total.count} orders`} highlight />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold text-parchment">Payouts</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Clock} label="Pending Payouts" value={formatInr(payouts.pendingInPaise)} sub={`${payouts.pendingCount} requests`} />
        <Stat icon={Wallet} label="Total Paid Out" value={formatInr(payouts.totalPaidInPaise)} />
        <Stat icon={CheckCircle2} label="Successful Withdrawals" value={String(payouts.successCount)} />
        <Stat icon={XCircle} label="Failed Withdrawals" value={String(payouts.failedCount)} />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold text-parchment">Course-wise Sales</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[500px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Course</th>
              <th className="px-4 pb-2">Orders</th>
              <th className="px-4 pb-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {sales.byCourse.map((c) => (
              <tr key={c.courseId} className="card">
                <td className="rounded-l-2xl px-4 py-3 text-parchment">{c.title}</td>
                <td className="px-4 py-3 text-parchment-muted">{c.count}</td>
                <td className="rounded-r-2xl px-4 py-3 font-medium text-parchment">{formatInr(c.amountInPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: typeof IndianRupee;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat-card ${highlight ? "border-gold-600/50 bg-gold-500/5" : ""}`}>
      <Icon className={`h-5 w-5 ${highlight ? "text-gold-400" : "text-gold-500"}`} />
      <p className="mt-3 text-2xl font-bold text-parchment">{value}</p>
      <p className="mt-1 text-xs text-parchment-muted">{label}{sub ? ` · ${sub}` : ""}</p>
    </div>
  );
}

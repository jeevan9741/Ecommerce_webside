"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatInr } from "@/lib/format";

interface Partner {
  id: string;
  name: string;
  email: string;
  referralCode: string;
  totalReferralOrders: number;
  creditedTotal: number;
  availableInPaise: number;
}

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<Partner[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/partners").then((r) => r.json()).then((d) => setPartners(d.partners));
  }, []);

  if (!partners) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">Partners</h1>
      <p className="mt-1 text-sm text-parchment-muted">{partners.length} active partners with referral sales</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[700px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Partner</th>
              <th className="px-4 pb-2">Referral Code</th>
              <th className="px-4 pb-2">Referral Sales</th>
              <th className="px-4 pb-2">Total Earned</th>
              <th className="px-4 pb-2">Available Balance</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id} className="card">
                <td className="rounded-l-2xl px-4 py-3">
                  <p className="text-parchment">{p.name}</p>
                  <p className="text-xs text-parchment-muted">{p.email}</p>
                </td>
                <td className="px-4 py-3 font-medium text-gold-400">{p.referralCode}</td>
                <td className="px-4 py-3 text-parchment-muted">{p.totalReferralOrders}</td>
                <td className="px-4 py-3 text-parchment">{formatInr(p.creditedTotal)}</td>
                <td className="rounded-r-2xl px-4 py-3 text-parchment">{formatInr(p.availableInPaise)}</td>
              </tr>
            ))}
            {partners.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-parchment-muted">
                  No partners with referral activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

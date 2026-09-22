import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock, Handshake, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { formatInr } from "@/lib/format";

export interface PartnerStats {
  referralCode: string;
  balance: { availableInPaise: number };
  earnings: { lifetime: number };
  pendingInPaise: number;
  approvedSales: number;
  pendingApprovals: number;
}

export function PartnerProgram({ stats }: { stats: PartnerStats | null }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-parchment">Partner &amp; Mentorship Program</h2>
      <p className="mt-1 text-sm text-parchment-muted">Earn commission for every student you bring to the academy.</p>

      {!stats ? (
        <p className="card mt-4 p-6 text-sm text-parchment-muted">
          Your referral earnings are unavailable right now. Please refresh in a moment.
        </p>
      ) : (
        <div className="card mt-4 overflow-hidden">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-gold-600 to-gold-500 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Handshake className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-blue-100">Your Referral Code</p>
                <p className="truncate text-xl font-bold tracking-wide">{stats.referralCode}</p>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-blue-100">Available to Withdraw</p>
              <p className="text-xl font-bold">{formatInr(stats.balance.availableInPaise)}</p>
            </div>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <Stat icon={TrendingUp} label="Total Earnings" value={formatInr(stats.earnings.lifetime)} />
            <Stat icon={BadgeCheck} label="Approved Sales" value={String(stats.approvedSales)} />
            <Stat
              icon={Clock}
              label="Pending Approvals"
              value={String(stats.pendingApprovals)}
              hint={stats.pendingInPaise > 0 ? `${formatInr(stats.pendingInPaise)} pending commission` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 border-t border-border-soft p-5 sm:flex sm:justify-end">
            <Link href="/dashboard/referrals" className="btn-outline !px-5 !py-2.5 text-sm">
              View Referral Details <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/dashboard/referrals/withdraw" className="btn-gold !px-5 !py-2.5 text-sm">
              <Wallet className="h-4 w-4" /> Request Payout
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-hover/60 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-parchment-muted">
        <Icon className="h-3.5 w-3.5 text-gold-500" />
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-bold text-parchment">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-parchment-muted">{hint}</p>}
    </div>
  );
}

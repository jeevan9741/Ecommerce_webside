import { Users, TrendingUp, Wallet, Clock } from "lucide-react";
import { formatInr, formatDate } from "@/lib/format";
import { ReferralLinkCard } from "@/components/dashboard/referral-link-card";
import type { PartnerStats } from "@/components/dashboard/partner-program";

/** The full /partner/stats payload; PartnerProgram only reads the summary subset of it. */
export interface PartnerStatsDetailed extends PartnerStats {
  earnings: { today: number; week: number; month: number; lifetime: number };
  referralCount: number;
  sales: {
    id: string;
    amountInPaise: number;
    status: string;
    createdAt: string;
    courseTitle: string;
    customerName: string;
  }[];
}

export function ReferralDetails({ stats }: { stats: PartnerStatsDetailed }) {
  return (
    <section id="referral-details" className="scroll-mt-24">
      <h2 className="font-display text-lg font-semibold text-parchment">Referral Details</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Available Balance" value={formatInr(stats.balance.availableInPaise)} highlight />
        <StatCard icon={TrendingUp} label="Total Earnings" value={formatInr(stats.earnings.lifetime)} />
        <StatCard icon={Clock} label="Pending Earnings" value={formatInr(stats.pendingInPaise)} />
        <StatCard icon={Users} label="Total Referrals" value={String(stats.referralCount)} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard icon={TrendingUp} label="Today's Earnings" value={formatInr(stats.earnings.today)} small />
        <StatCard icon={TrendingUp} label="This Week" value={formatInr(stats.earnings.week)} small />
        <StatCard icon={TrendingUp} label="This Month" value={formatInr(stats.earnings.month)} small />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-parchment">Commission History</h3>
          <div className="mt-4 space-y-2">
            {stats.sales.length === 0 && (
              <p className="card p-6 text-center text-sm text-parchment-muted">
                No referral sales yet — share your link to start earning.
              </p>
            )}
            {stats.sales.map((s) => (
              <div key={s.id} className="card flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-parchment">{s.courseTitle}</p>
                  <p className="text-xs text-parchment-muted">
                    {s.customerName} · {formatDate(s.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-emerald">+{formatInr(s.amountInPaise)}</p>
                  <p className="text-xs text-parchment-muted">{s.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold text-parchment">Your Referral Link</h3>
          <div className="mt-4">
            <ReferralLinkCard referralCode={stats.referralCode} />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  small,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`stat-card ${highlight ? "border-gold-600/50 bg-gold-500/5" : ""}`}>
      <Icon className={`h-5 w-5 ${highlight ? "text-gold-400" : "text-gold-500"}`} />
      <p className={`mt-3 font-bold text-parchment ${small ? "text-lg" : "text-2xl"}`}>{value}</p>
      <p className="mt-1 text-xs text-parchment-muted">{label}</p>
    </div>
  );
}

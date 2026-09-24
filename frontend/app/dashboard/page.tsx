import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock,
  HandCoins,
  IdCard,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { serverApi } from "@/lib/session";
import { getDashboardSummary, getEnrolledAccess } from "@/lib/dashboard";
import { formatInr } from "@/lib/format";
import { packageName, sortByPackage } from "@/components/dashboard/enrolled-packages";
import type { PartnerStats } from "@/components/dashboard/partner-program";

const SECTIONS: { href: string; title: string; description: string; icon: LucideIcon }[] = [
  { href: "/dashboard/profile", title: "My Profile", description: "Your photo, contact details and learning language.", icon: User },
  { href: "/dashboard/id-card", title: "My ID Card", description: "Upload your photo and download your student ID.", icon: IdCard },
  { href: "/dashboard/courses", title: "My Courses", description: "Open your unlocked package content and support.", icon: BookOpen },
  { href: "/dashboard/referral", title: "Referral & Earnings", description: "Your referral code, earnings and payouts.", icon: Users },
  {
    href: "/dashboard/referral/claim",
    title: "Claim Partner Commission",
    description: "Submit a referred student's Order ID / UTR.",
    icon: HandCoins,
  },
];

export default async function DashboardOverviewPage() {
  const [{ user, memberSince }, access, partnerStats] = await Promise.all([
    getDashboardSummary(),
    getEnrolledAccess(),
    // Earnings are a nice-to-have on the overview — a hiccup there must not take the page down.
    serverApi<PartnerStats>("/partner/stats").catch(() => null),
  ]);
  const packages = [...new Set(sortByPackage(access).map((a) => packageName(a.course.type)))];

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Welcome back, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-parchment-muted">Here&apos;s a quick look at your student account.</p>
      </div>

      <section>
        <h2 className="font-display text-lg font-semibold text-parchment">Account Summary</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            icon={BookOpen}
            label="Enrolled Packages"
            value={String(access.length)}
            hint={packages.length > 0 ? packages.join(", ") : "No package yet"}
            highlight
          />
          <SummaryTile
            icon={Wallet}
            label="Available to Withdraw"
            value={partnerStats ? formatInr(partnerStats.balance.availableInPaise) : "—"}
          />
          <SummaryTile
            icon={Clock}
            label="Pending Approvals"
            value={partnerStats ? String(partnerStats.pendingApprovals) : "—"}
          />
          <SummaryTile icon={CalendarDays} label="Member Since" value={memberSince} />
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold text-parchment">Your Portal</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SECTIONS.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="card group flex items-start gap-4 p-5 transition hover:border-gold-500/50"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-md">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold text-parchment">
                  {title}
                  <ArrowRight className="h-4 w-4 text-gold-500 transition group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-sm text-parchment-muted">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`stat-card min-w-0 ${highlight ? "border-gold-600/50 bg-gold-500/5" : ""}`}>
      <Icon className={`h-5 w-5 ${highlight ? "text-gold-400" : "text-gold-500"}`} />
      <p className="mt-3 truncate text-2xl font-bold text-parchment">{value}</p>
      <p className="mt-1 text-xs text-parchment-muted">{label}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-parchment-muted">{hint}</p>}
    </div>
  );
}

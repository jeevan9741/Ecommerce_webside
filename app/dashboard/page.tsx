import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatInr } from "@/lib/format";
import { getPartnerBalance } from "@/lib/commission";
import { ProfileForm } from "@/components/dashboard/profile-form";

export default async function DashboardOverviewPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [coursesOwned, ordersCount, balance, user, languages] = await Promise.all([
    prisma.courseAccess.count({ where: { userId, revokedAt: null } }),
    prisma.order.count({ where: { userId } }),
    getPartnerBalance(userId),
    prisma.user.findUnique({ where: { id: userId }, include: { preferredLanguage: true } }),
    prisma.language.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { code: true, name: true, nativeName: true },
    }),
  ]);
  if (!user) return null;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-parchment">
        Welcome back, {session!.user.name?.split(" ")[0]}
      </h1>
      <p className="mt-1 text-sm text-parchment-muted">Here&apos;s a quick look at your account.</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          icon={BookOpen}
          label="My Courses"
          value={String(coursesOwned)}
          href="/dashboard/courses"
          cta={coursesOwned === 0 ? "Browse courses" : "View courses"}
        />
        <SummaryCard
          icon={Users}
          label="Referral & Earnings"
          value={formatInr(balance.availableInPaise)}
          href="/dashboard/referrals"
          cta="View earnings"
        />
        <SummaryCard icon={ClipboardList} label="Activity" value={String(ordersCount)} href="/dashboard/activity" cta="View activity" />
      </div>

      {coursesOwned === 0 && (
        <div className="card mt-6 flex flex-col items-center gap-4 p-12 text-center">
          <BookOpen className="h-10 w-10 text-gold-500" />
          <p className="text-sm text-parchment-muted">You haven&apos;t unlocked any courses yet.</p>
          <Link href="/courses" className="btn-gold">
            Browse Courses <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold text-parchment">Account Details</h2>
        <p className="mt-1 text-sm text-parchment-muted">Manage the details shown across your account.</p>

        <div className="mt-4">
          <ProfileForm
            initialName={user.name}
            initialPhone={user.phone ?? ""}
            initialLanguageCode={user.preferredLanguage?.code ?? ""}
            languages={languages}
            email={user.email}
            username={user.username}
            memberSince={formatDate(user.createdAt)}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  href,
  cta,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href} className="card card-hover flex flex-col gap-3 p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold-600/40 bg-gold-500/10">
        <Icon className="h-5 w-5 text-gold-400" />
      </div>
      <div>
        <p className="text-2xl font-bold text-parchment">{value}</p>
        <p className="text-xs text-parchment-muted">{label}</p>
      </div>
      <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-gold-500">
        {cta} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

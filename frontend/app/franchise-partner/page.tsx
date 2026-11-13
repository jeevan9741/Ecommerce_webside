import Link from "next/link";
import { BookOpen, Building2, CalendarRange, GraduationCap, MapPin, ShieldCheck, TrendingUp, Users, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";
import { requirePartnerProfile } from "@/lib/franchise-partner";

export const dynamic = "force-dynamic";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

interface Overview {
  students: number;
  enrolments: { active: number; ended: number };
  progress: { completed: number; inProgress: number; notStarted: number; unavailable: number; counted: number; partial: boolean };
  earnings: { available: boolean; message: string };
}

/** The partner's own franchise at a glance — every figure comes from the API, scoped to this franchise. */
export default async function FranchisePartnerOverviewPage() {
  const p = await requirePartnerProfile();
  const session = await getSession();
  const overview = await api.get<Overview>("/franchise-partner/overview", { token: session?.token ?? null }).catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Franchise Dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-parchment">Welcome, {p.ownerName}</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Franchise {p.franchiseCode} · {p.territory?.state ?? p.state}. This dashboard shows your own franchise only.
        </p>
      </div>

      {overview ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card icon={Users} label="Students" value={String(overview.students)} note="Linked to your franchise" href="/franchise-partner/students" />
          <Card
            icon={BookOpen}
            label="Course enrolments"
            value={String(overview.enrolments.active)}
            note={overview.enrolments.ended ? `Active · ${overview.enrolments.ended} ended` : "Active"}
            href="/franchise-partner/enrolments"
          />
          <ProgressCard progress={overview.progress} />
          <Card icon={Wallet} label="Referral & earnings" value="Not available yet" note={overview.earnings.message} href="/franchise-partner/earnings" small />
        </div>
      ) : (
        <p role="alert" className="card p-5 text-sm text-danger">
          We couldn&apos;t load your figures right now. Please refresh the page in a moment.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact icon={<Building2 className="h-5 w-5 text-gold-500" />} label="Franchise code" value={p.franchiseCode} />
        <Fact icon={<MapPin className="h-5 w-5 text-gold-500" />} label="State" value={p.territory?.state ?? p.state} note={`Training centre: ${p.district}`} />
        <Fact icon={<CalendarRange className="h-5 w-5 text-gold-500" />} label="Agreement" value={`${date(p.agreementStartsAt)} – ${date(p.agreementEndsAt)}`} />
        <Fact icon={<ShieldCheck className="h-5 w-5 text-gold-500" />} label="Status" value={p.status === "ACTIVE" ? "Active" : p.status} />
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, note, href, small = false }: { icon: typeof Users; label: string; value: string; note: string; href: string; small?: boolean }) {
  return (
    <Link href={href} className="card card-hover block p-5">
      <Icon className="h-5 w-5 text-gold-500" aria-hidden="true" />
      <p className="mt-3 text-xs uppercase tracking-wide text-parchment-muted">{label}</p>
      <p className={`mt-1 font-display font-bold text-parchment ${small ? "text-lg" : "text-3xl"}`}>{value}</p>
      <p className="mt-1 text-xs text-parchment-muted">{note}</p>
    </Link>
  );
}

function ProgressCard({ progress }: { progress: Overview["progress"] }) {
  const tracked = progress.completed + progress.inProgress + progress.notStarted;
  return (
    <Link href="/franchise-partner/progress" className="card card-hover block p-5">
      <TrendingUp className="h-5 w-5 text-gold-500" aria-hidden="true" />
      <p className="mt-3 text-xs uppercase tracking-wide text-parchment-muted">Learning progress</p>
      {progress.counted === 0 ? (
        <p className="mt-1 text-sm text-parchment-muted">No active enrolments yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          <li className="flex justify-between gap-3"><span className="text-parchment-muted">Completed</span><span className="font-semibold text-parchment">{progress.completed}</span></li>
          <li className="flex justify-between gap-3"><span className="text-parchment-muted">In progress</span><span className="font-semibold text-parchment">{progress.inProgress}</span></li>
          <li className="flex justify-between gap-3"><span className="text-parchment-muted">Not started</span><span className="font-semibold text-parchment">{progress.notStarted}</span></li>
          {progress.unavailable > 0 && (
            <li className="flex justify-between gap-3"><span className="text-parchment-muted">Progress data unavailable</span><span className="font-semibold text-parchment">{progress.unavailable}</span></li>
          )}
        </ul>
      )}
      <p className="mt-2 text-xs text-parchment-muted">
        <GraduationCap className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
        {tracked} tracked {tracked === 1 ? "enrolment" : "enrolments"}
        {progress.partial ? ` (latest ${progress.counted} only)` : ""}
      </p>
    </Link>
  );
}

function Fact({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string | null }) {
  return (
    <div className="card p-5">
      {icon}
      <p className="mt-3 text-xs uppercase tracking-wide text-parchment-muted">{label}</p>
      <p className="mt-1 font-semibold text-parchment">{value}</p>
      {note && <p className="mt-0.5 text-xs text-parchment-muted">{note}</p>}
    </div>
  );
}

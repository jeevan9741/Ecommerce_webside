import { Building2, CalendarRange, MapPin, ShieldCheck } from "lucide-react";
import { requirePartnerProfile } from "@/lib/franchise-partner";

export const dynamic = "force-dynamic";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function FranchisePartnerOverviewPage() {
  const p = await requirePartnerProfile();
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Franchise Dashboard</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-parchment">Welcome, {p.ownerName}</h1>
        <p className="mt-1 text-sm text-parchment-muted">This dashboard shows your own franchise only.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact icon={<Building2 className="h-5 w-5 text-gold-500" />} label="Franchise code" value={p.franchiseCode} />
        <Fact icon={<MapPin className="h-5 w-5 text-gold-500" />} label="District" value={`${p.district}, ${p.state}`} note={p.districtCode ? `LGD ${p.districtCode}` : null} />
        <Fact icon={<CalendarRange className="h-5 w-5 text-gold-500" />} label="Agreement" value={`${date(p.agreementStartsAt)} – ${date(p.agreementEndsAt)}`} />
        <Fact icon={<ShieldCheck className="h-5 w-5 text-gold-500" />} label="Status" value={p.status === "ACTIVE" ? "Active" : p.status} />
      </div>

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-parchment">Coming next</h2>
        <p className="mt-2 text-sm text-parchment-muted">
          Support requests, and your collections, commissions and settlements, will appear here as they become available. Invite and follow your students under Students.
        </p>
      </section>
    </div>
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

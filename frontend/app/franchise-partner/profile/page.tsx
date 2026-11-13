import { requirePartnerProfile } from "@/lib/franchise-partner";

export const dynamic = "force-dynamic";

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }) : "—");

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", SUSPENDED: "Suspended", DEACTIVATED: "Deactivated", EXPIRED: "Expired" };
const TERRITORY_LABEL: Record<string, string> = { ALLOCATED: "Allocated to your franchise", SUSPENDED: "Held, franchise suspended" };

/**
 * The partner's own franchise record, read-only. Everything here is set by ETA's admins (activation,
 * state allocation, status); the partner can't change any of it from the dashboard.
 */
export default async function FranchiseProfilePage() {
  const p = await requirePartnerProfile();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Profile</h1>
        <p className="mt-1 text-sm text-parchment-muted">Your franchise record as held by ETA. To change anything here, contact ETA through Support.</p>
      </div>

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-parchment">Franchise</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Item label="Franchise code" value={p.franchiseCode} />
          <Item label="Status" value={STATUS_LABEL[p.status] ?? p.status} />
          <Item label="Owner" value={p.ownerName} />
          <Item label="Account email" value={p.ownerEmail} />
          <Item label="Activated" value={date(p.activatedAt)} />
          <Item label="Agreement period" value={`${date(p.agreementStartsAt)} – ${date(p.agreementEndsAt)}`} />
        </dl>
      </section>

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-parchment">Territory</h2>
        <p className="mt-1 text-xs text-parchment-muted">ETA works with one primary franchise per state. State allocation is managed by ETA&apos;s admins only.</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Item label="State" value={p.territory?.state ?? p.state} />
          <Item label="State allocation" value={p.territory ? (TERRITORY_LABEL[p.territory.status] ?? p.territory.status) : "Not recorded"} />
          <Item label="Allocated on" value={date(p.territory?.allocatedAt ?? null)} />
          <Item label="Training centre district" value={`${p.district}${p.districtCode ? ` (LGD ${p.districtCode})` : ""}`} />
        </dl>
      </section>

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-parchment">Permissions</h2>
        <ul className="mt-3 space-y-2 text-sm text-parchment-muted">
          <li>You can view your own students, their course enrolments and learning progress, invite students, and contact ETA support.</li>
          <li>Activation, suspension, state allocation, student ownership, financial records and payouts are managed by ETA&apos;s admins.</li>
          <li>Student order attribution: {p.attributionAllowed ? "allowed" : "not enabled"} · Payouts: {p.payoutsPaused ? "paused" : "not set up yet"}.</li>
        </ul>
      </section>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-parchment-muted">{label}</dt>
      <dd className="mt-1 text-parchment">{value}</dd>
    </div>
  );
}

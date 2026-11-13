import { Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";
import { requirePartnerProfile } from "@/lib/franchise-partner";

export const dynamic = "force-dynamic";

const FALLBACK = "Earnings information will be available after the franchise financial system is activated.";

/**
 * Read-only earnings status. No franchise earnings, settlement or payout records exist yet, so the page
 * shows the server's status message only — never figures estimated from prices or enrolments.
 */
export default async function FranchiseEarningsPage() {
  await requirePartnerProfile();
  const session = await getSession();
  const earnings = await api
    .get<{ earnings: { available: boolean; message: string; referral?: { available: boolean; message: string } } }>("/franchise-partner/earnings", { token: session?.token ?? null })
    .then((r) => r.earnings)
    .catch(() => null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Referral &amp; Earnings</h1>
        <p className="mt-1 text-sm text-parchment-muted">Your own franchise earnings, referral commission, settlements and payouts.</p>
      </div>
      <section className="card flex items-start gap-4 p-6" role="status">
        <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-gold-500" aria-hidden="true" />
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment">Earnings: not available yet</h2>
          <p className="mt-2 text-sm text-parchment-muted">{earnings?.message ?? FALLBACK}</p>
          <p className="mt-3 text-xs text-parchment-muted">
            Revenue share, referral commission, refunds and payouts will be listed here once they are recorded by the franchise financial system. Nothing here is estimated.
          </p>
        </div>
      </section>
      <section className="card flex items-start gap-4 p-6" role="status">
        <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-gold-500" aria-hidden="true" />
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment">Referral commission: not available yet</h2>
          <p className="mt-2 text-sm text-parchment-muted">{earnings?.referral?.message ?? "Franchise referral commission isn't set up yet."}</p>
        </div>
      </section>
    </div>
  );
}

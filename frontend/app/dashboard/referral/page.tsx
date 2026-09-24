import { serverApi } from "@/lib/session";
import { PartnerProgram } from "@/components/dashboard/partner-program";
import { ReferralDetails, type PartnerStatsDetailed } from "@/components/dashboard/referral-details";
import { DashboardPageHeader } from "@/components/dashboard/page-header";

export default async function ReferralPage() {
  // One /partner/stats call feeds both the summary card and the detailed breakdown below it.
  const stats = await serverApi<PartnerStatsDetailed>("/partner/stats").catch(() => null);

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <DashboardPageHeader
          title="Referral & Earnings"
          description="Earn commission for every student you bring to the academy."
        />
        <PartnerProgram stats={stats} />
      </div>
      {stats && <ReferralDetails stats={stats} />}
    </div>
  );
}

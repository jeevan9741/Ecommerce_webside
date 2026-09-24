import { serverApi } from "@/lib/session";
import { formatInr } from "@/lib/format";
import { packageName } from "@/components/dashboard/enrolled-packages";
import { ReferralClaimForm, type ReferralClaimRow } from "@/components/dashboard/referral-claim-form";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import type { CoursePublic } from "@/components/course-card";

export default async function ClaimCommissionPage() {
  const [claims, courses] = await Promise.all([
    serverApi<{ claims: ReferralClaimRow[] }>("/referral-claims")
      .then((r) => r.claims)
      .catch(() => null),
    serverApi<{ courses: Pick<CoursePublic, "id" | "type" | "priceInPaise">[] }>("/courses")
      .then((r) => r.courses)
      .catch(() => []),
  ]);
  const packages = [...courses]
    .sort((a, b) => a.priceInPaise - b.priceInPaise)
    .map((c) => ({ id: c.id, label: `${formatInr(c.priceInPaise)} ${packageName(c.type)}` }));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Claim Partner Commission"
        description="Referred a student who paid without your link? Submit their Order ID / UPI UTR to claim your commission."
      />
      <ReferralClaimForm packages={packages} claims={claims} />
    </div>
  );
}

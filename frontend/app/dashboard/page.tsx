import { serverApi } from "@/lib/session";
import { formatDate, formatInr } from "@/lib/format";
import { getContact } from "@/lib/contact";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { EnrolledPackages, packageName, sortByPackage, type EnrolledAccess } from "@/components/dashboard/enrolled-packages";
import { IdCard } from "@/components/dashboard/id-card";
import { PartnerProgram, type PartnerStats } from "@/components/dashboard/partner-program";
import { ReferralClaimForm, type ReferralClaimRow } from "@/components/dashboard/referral-claim-form";
import type { CoursePublic } from "@/components/course-card";

interface DashboardSummary {
  languages: { code: string; name: string; nativeName: string }[];
  user: {
    id: string;
    name: string;
    email: string;
    username: string;
    phone: string | null;
    createdAt: string;
    preferredLanguageCode: string | null;
  };
}

export default async function DashboardOverviewPage() {
  const [{ user, languages }, { access }, contact, partnerStats, claims, courses] = await Promise.all([
    serverApi<DashboardSummary>("/me/dashboard"),
    serverApi<{ access: EnrolledAccess[] }>("/me/courses"),
    getContact(),
    // Referral sections degrade on their own — a hiccup there must not take down the whole portal.
    serverApi<PartnerStats>("/partner/stats").catch(() => null),
    serverApi<{ claims: ReferralClaimRow[] }>("/referral-claims")
      .then((r) => r.claims)
      .catch(() => null),
    serverApi<{ courses: Pick<CoursePublic, "id" | "type" | "priceInPaise">[] }>("/courses")
      .then((r) => r.courses)
      .catch(() => []),
  ]);
  const memberSince = formatDate(user.createdAt);
  const claimPackages = [...courses]
    .sort((a, b) => a.priceInPaise - b.priceInPaise)
    .map((c) => ({ id: c.id, label: `${formatInr(c.priceInPaise)} ${packageName(c.type)}` }));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-parchment-muted">Your profile, ID card, referral earnings and course content in one place.</p>
      </div>

      <section>
        <h2 className="font-display text-lg font-semibold text-parchment">My Profile</h2>
        <p className="mt-1 text-sm text-parchment-muted">Your photo and student details.</p>
        <div className="mt-4">
          <ProfileForm
            userId={user.id}
            initialName={user.name}
            initialPhone={user.phone ?? ""}
            initialLanguageCode={user.preferredLanguageCode ?? ""}
            languages={languages}
            email={user.email}
            username={user.username}
            memberSince={memberSince}
          />
        </div>
      </section>

      <IdCard
        userId={user.id}
        name={user.name}
        username={user.username}
        email={user.email}
        phone={user.phone}
        memberSince={memberSince}
        packages={[...new Set(sortByPackage(access).map((a) => packageName(a.course.type)))]}
      />

      <PartnerProgram stats={partnerStats} />

      <ReferralClaimForm packages={claimPackages} claims={claims} />

      <EnrolledPackages access={access} contact={contact} />
    </div>
  );
}

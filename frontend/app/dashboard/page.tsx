import { serverApi } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { getContact } from "@/lib/contact";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { EnrolledPackages, packageName, sortByPackage, type EnrolledAccess } from "@/components/dashboard/enrolled-packages";
import { IdCard } from "@/components/dashboard/id-card";

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
  const [{ user, languages }, { access }, contact] = await Promise.all([
    serverApi<DashboardSummary>("/me/dashboard"),
    serverApi<{ access: EnrolledAccess[] }>("/me/courses"),
    getContact(),
  ]);
  const memberSince = formatDate(user.createdAt);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-parchment-muted">Your profile, ID card and course content in one place.</p>
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

      <EnrolledPackages access={access} contact={contact} />
    </div>
  );
}

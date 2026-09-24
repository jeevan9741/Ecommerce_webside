import { getDashboardSummary } from "@/lib/dashboard";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { DashboardPageHeader } from "@/components/dashboard/page-header";

export default async function ProfilePage() {
  const { user, languages, memberSince } = await getDashboardSummary();

  return (
    <div className="space-y-6">
      <DashboardPageHeader title="My Profile" description="Your photo and student details." />
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
  );
}

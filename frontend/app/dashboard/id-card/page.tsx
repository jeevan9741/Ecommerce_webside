import { getDashboardSummary, getEnrolledAccess } from "@/lib/dashboard";
import { IdCard } from "@/components/dashboard/id-card";
import { packageName, sortByPackage } from "@/components/dashboard/enrolled-packages";
import { DashboardPageHeader } from "@/components/dashboard/page-header";

export default async function IdCardPage() {
  const [{ user, memberSince }, access] = await Promise.all([getDashboardSummary(), getEnrolledAccess()]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Student ID Card"
        description="Upload a passport-size photo, then save it to generate your ID card."
      />
      <IdCard
        userId={user.id}
        name={user.name}
        username={user.username}
        email={user.email}
        phone={user.phone}
        memberSince={memberSince}
        packages={[...new Set(sortByPackage(access).map((a) => packageName(a.course.type)))]}
      />
    </div>
  );
}

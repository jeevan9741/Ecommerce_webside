import { getEnrolledAccess } from "@/lib/dashboard";
import { getContact } from "@/lib/contact";
import { EnrolledPackages } from "@/components/dashboard/enrolled-packages";
import { DashboardPageHeader } from "@/components/dashboard/page-header";

export default async function MyCoursesPage() {
  // Only purchased, still-live access comes back from /me/courses — nothing here is unlocked otherwise.
  const [access, contact] = await Promise.all([getEnrolledAccess(), getContact()]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader title="My Courses" description="Your enrolled package content and support." />
      <EnrolledPackages access={access} contact={contact} />
    </div>
  );
}

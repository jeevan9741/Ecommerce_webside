import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { MyCertificates } from "@/components/certificates/my-certificates";

export default function MyCertificatesPage() {
  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="My Certificates"
        description="Your course completion certificates — download, print or share them any time."
      />
      <MyCertificates />
    </div>
  );
}

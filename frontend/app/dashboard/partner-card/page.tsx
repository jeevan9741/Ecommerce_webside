import type { Metadata } from "next";
import { serverApi } from "@/lib/session";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { PartnerCardManager } from "@/components/partner-card/partner-card-manager";
import type { PartnerCard } from "@/lib/partner-card/types";
import type { PartnerCardDefaults } from "@/services/partnerCardService";

export const metadata: Metadata = { title: "Partner ID Card" };

export default async function PartnerCardPage() {
  const { card, defaults } = await serverApi<{ card: PartnerCard | null; defaults: PartnerCardDefaults }>("/partner-card");

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Partner ID Card"
        description="Your official Authorized Business Partner card — preview, download, print and verify it by QR."
      />
      <PartnerCardManager initialCard={card} defaults={defaults} />
    </div>
  );
}

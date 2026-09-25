import type { Metadata } from "next";
import { getPublicPartner, normalisePartnerId } from "@/lib/partner-card/public";
import { PartnerNotFound, PartnerVerification } from "@/components/partner-card/verification";

export const dynamic = "force-dynamic";

// Partner records are for people holding the card, not for search engines.
export const metadata: Metadata = { title: "Verify Partner", robots: { index: false, follow: false } };

/** Where a card's QR code lands. `?t=` identifies which print of the card was scanned. */
export default async function VerifyPartnerPage({ params, searchParams }: PageProps<"/verify/[partnerId]">) {
  const { partnerId: raw } = await params;
  const { t } = await searchParams;
  const partnerId = normalisePartnerId(raw);
  const partner = await getPublicPartner(partnerId, typeof t === "string" ? t : null);

  return (
    <div className="container-academy py-12 sm:py-20">
      <div className="mx-auto max-w-xl">
        {partner ? <PartnerVerification partner={partner} /> : <PartnerNotFound partnerId={partnerId} />}
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { normalisePartnerId } from "@/lib/partner-card/public";

/** Short partner link; the verification page is the single public record of a card. */
export default async function PartnerProfilePage({ params, searchParams }: PageProps<"/partner/[partnerId]">) {
  const { partnerId } = await params;
  const { t } = await searchParams;
  const qs = typeof t === "string" ? `?t=${encodeURIComponent(t)}` : "";
  redirect(`/verify/${encodeURIComponent(normalisePartnerId(partnerId))}${qs}`);
}

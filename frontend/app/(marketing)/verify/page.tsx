import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { normalisePartnerId } from "@/lib/partner-card/public";

export const metadata: Metadata = {
  title: "Verify a Partner ID",
  description: "Check whether an E-Commerce Training Academy Partner ID card is genuine and active.",
};

export default async function VerifyLookupPage({ searchParams }: PageProps<"/verify">) {
  const { id } = await searchParams;
  const typed = typeof id === "string" ? id : "";
  const partnerId = normalisePartnerId(typed);
  if (/^[A-Z0-9-]{3,20}$/.test(partnerId)) redirect(`/verify/${partnerId}`);

  return (
    <div className="container-academy py-12 sm:py-20">
      <div className="card mx-auto max-w-xl p-6 sm:p-8">
        <ShieldCheck className="h-10 w-10 text-gold-500" />
        <h1 className="mt-4 font-display text-2xl font-bold text-parchment">Verify a Partner ID</h1>
        <p className="mt-2 text-sm text-parchment-muted">
          Enter the Partner ID printed on the card (for example <span className="font-mono">ECTA-BP001</span>), or scan
          the QR code on its front.
        </p>
        <form action="/verify" className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            name="id"
            required
            defaultValue={typed}
            placeholder="ECTA-BP001"
            aria-label="Partner ID"
            className="input-field font-mono uppercase sm:flex-1"
          />
          <button type="submit" className="btn-gold">
            Verify
          </button>
        </form>
        {typed && <p className="field-error">That doesn&apos;t look like a Partner ID.</p>}
      </div>
    </div>
  );
}

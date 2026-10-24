import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Award } from "lucide-react";
import { normaliseCertificateNo } from "@/lib/certificate/verify";

export const metadata: Metadata = {
  title: "Verify a Certificate",
  description: "Check whether an E-Commerce Training Academy course completion certificate is genuine.",
};

const CERTIFICATE_NO = /^ECA-\d{4}-[A-Z0-9]{6}$/;

export default async function VerifyCertificateLookupPage({ searchParams }: PageProps<"/verify-certificate">) {
  const { id } = await searchParams;
  const typed = typeof id === "string" ? id : "";
  const certificateNo = normaliseCertificateNo(typed);
  if (CERTIFICATE_NO.test(certificateNo)) redirect(`/verify-certificate/${certificateNo}`);

  return (
    <div className="container-academy py-12 sm:py-20">
      <div className="card mx-auto max-w-xl p-6 sm:p-8">
        <Award className="h-10 w-10 text-gold-500" />
        <h1 className="mt-4 font-display text-2xl font-bold text-parchment">Verify a Certificate</h1>
        <p className="mt-2 text-sm text-parchment-muted">
          Enter the Certificate ID printed on the certificate (for example <span className="font-mono">ECA-2026-K7Q3XM</span>),
          or scan its QR code.
        </p>
        <form action="/verify-certificate" className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            name="id"
            required
            defaultValue={typed}
            placeholder="ECA-2026-K7Q3XM"
            aria-label="Certificate ID"
            className="input-field font-mono uppercase sm:flex-1"
          />
          <button type="submit" className="btn-gold">
            Verify
          </button>
        </form>
        {typed && <p className="field-error">That doesn&apos;t look like a Certificate ID.</p>}
      </div>
    </div>
  );
}

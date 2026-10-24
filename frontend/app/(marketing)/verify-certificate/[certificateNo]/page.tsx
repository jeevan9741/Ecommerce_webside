import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, SearchX, ShieldAlert } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatCertificateDate } from "@/lib/certificate/design";
import { normaliseCertificateNo } from "@/lib/certificate/verify";
import { certificateService, type PublicCertificate } from "@/services/certificateService";

export const dynamic = "force-dynamic";

// Certificate records are for the people checking them, not for search engines.
export const metadata: Metadata = { title: "Verify Certificate", robots: { index: false, follow: false } };

async function lookup(certificateNo: string): Promise<PublicCertificate | null> {
  try {
    return (await certificateService.verify(certificateNo)).certificate;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Where a certificate's QR code lands. */
export default async function VerifyCertificatePage({ params }: PageProps<"/verify-certificate/[certificateNo]">) {
  const { certificateNo: raw } = await params;
  const certificateNo = normaliseCertificateNo(raw);
  const certificate = await lookup(certificateNo);

  return (
    <div className="container-academy py-12 sm:py-20">
      <div className="card mx-auto max-w-xl overflow-hidden">
        {!certificate ? (
          <div className="p-6 text-center sm:p-8">
            <SearchX className="mx-auto h-12 w-12 text-danger" />
            <h1 className="mt-4 font-display text-2xl font-bold text-parchment">Certificate not found</h1>
            <p className="mt-2 text-sm text-parchment-muted">
              No certificate with the ID <span className="font-mono font-semibold text-parchment">{certificateNo}</span> was issued by
              E-Commerce Training Academy. Check the ID and try again.
            </p>
          </div>
        ) : (
          <>
            <div className={`flex items-center gap-3 px-6 py-5 sm:px-8 ${certificate.status === "VALID" ? "bg-emerald/10" : "bg-danger/10"}`}>
              {certificate.status === "VALID" ? (
                <BadgeCheck className="h-9 w-9 shrink-0 text-emerald" />
              ) : (
                <ShieldAlert className="h-9 w-9 shrink-0 text-danger" />
              )}
              <div>
                <p className={`text-lg font-bold ${certificate.status === "VALID" ? "text-emerald" : "text-danger"}`}>
                  {certificate.status === "VALID" ? "Verified certificate" : "Certificate revoked"}
                </p>
                <p className="text-xs text-parchment-muted">
                  {certificate.status === "VALID"
                    ? "Issued by E-Commerce Training Academy."
                    : "This certificate was issued by E-Commerce Training Academy but is no longer valid."}
                </p>
              </div>
            </div>
            <dl className="divide-y divide-border-soft px-6 sm:px-8">
              {[
                ["Student", certificate.studentName],
                ["Course", certificate.courseTitle],
                ["Completed on", formatCertificateDate(certificate.completedAt)],
                ["Certificate ID", certificate.certificateNo],
              ].map(([term, value]) => (
                <div key={term} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{term}</dt>
                  <dd className={`text-sm font-semibold text-parchment sm:text-right ${term === "Certificate ID" ? "font-mono" : ""}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <div className="border-t border-border-soft px-6 py-4 text-center sm:px-8">
          <Link href="/verify-certificate" className="text-sm font-semibold text-gold-500 hover:underline">
            Verify another certificate
          </Link>
        </div>
      </div>
    </div>
  );
}

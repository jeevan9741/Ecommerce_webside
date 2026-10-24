"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download, ImageDown, Link2, Loader2, Printer } from "lucide-react";
import { CertificatePreview } from "@/components/certificates/certificate-preview";
import { certificateVerifyUrl } from "@/lib/certificate/verify";
import { certificateFileUrl, certificateService, type CourseCertificate, type Signatory } from "@/services/certificateService";

/** One certificate: full preview, downloads, print, and the verification link. */
export function CertificateViewer({ certificateNo }: { certificateNo: string }) {
  const [data, setData] = useState<{ certificate: CourseCertificate; signatory: Signatory } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    certificateService
      .get(certificateNo)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the certificate."));
  }, [certificateNo]);

  const art = useMemo(
    () =>
      data && {
        certificateNo: data.certificate.certificateNo,
        studentName: data.certificate.studentName,
        courseTitle: data.certificate.courseTitle,
        completedAt: data.certificate.completedAt,
        signatoryName: data.signatory.name,
        signatoryTitle: data.signatory.title,
        signatureHref: data.signatory.signatureUrl,
        verifyUrl: certificateVerifyUrl(data.certificate.certificateNo),
      },
    [data]
  );

  const back = (
    <Link href="/dashboard/certificates" className="inline-flex items-center gap-1 text-xs font-semibold text-gold-500 hover:underline">
      <ArrowLeft className="h-3.5 w-3.5" /> My Certificates
    </Link>
  );

  if (error) {
    return (
      <div>
        {back}
        <p className="card mt-4 p-5 text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!data || !art) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const revoked = data.certificate.status === "REVOKED";
  const no = data.certificate.certificateNo;
  return (
    <div>
      {back}
      <h1 className="mt-3 font-display text-2xl font-semibold text-parchment">{data.certificate.courseTitle}</h1>
      <p className="mt-1 text-sm text-parchment-muted">Certificate ID {no}</p>

      <div className="mt-5">
        <CertificatePreview art={art} watermark={revoked ? "REVOKED" : null} />
      </div>

      {revoked ? (
        <p className="mt-4 text-sm font-semibold text-danger">This certificate has been revoked. Please contact support.</p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={certificateFileUrl(no, "certificate.pdf")} className="btn-gold btn-sm">
            <Download className="h-4 w-4" /> Download PDF
          </a>
          {/* The PDF opens in the browser's viewer, which prints it at true A4 size. */}
          <a href={certificateFileUrl(no, "certificate.pdf", false)} target="_blank" rel="noopener" className="btn-outline btn-sm">
            <Printer className="h-4 w-4" /> Print
          </a>
          <a href={certificateFileUrl(no, "certificate.png")} className="btn-outline btn-sm">
            <ImageDown className="h-4 w-4" /> Download image
          </a>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(certificateVerifyUrl(no)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
            className="btn-ghost btn-sm"
          >
            {copied ? <Check className="h-4 w-4 text-emerald" /> : <Link2 className="h-4 w-4" />} Copy verification link
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-parchment-muted">Tip: print on A4 landscape at 100% (&ldquo;Actual size&rdquo;).</p>
    </div>
  );
}

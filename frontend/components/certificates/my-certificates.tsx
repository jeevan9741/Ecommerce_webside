"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Award, Check, Copy, Download, Eye, Loader2, Lock } from "lucide-react";
import { ProgressBar } from "@/components/library/category-theme";
import { formatCertificateDate } from "@/lib/certificate/design";
import {
  certificateFileUrl,
  certificateService,
  type CourseCertificate,
  type MyCourseCertificateStatus,
} from "@/services/certificateService";

/** Issued certificates, then the courses still on their way to one. */
export function MyCertificates() {
  const [data, setData] = useState<{ certificates: CourseCertificate[]; courses: MyCourseCertificateStatus[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    certificateService
      .mine()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your certificates."));
  }, []);

  if (error) return <p className="card p-5 text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const pending = data.courses.filter((c) => !c.certificateNo);
  return (
    <div className="space-y-8">
      {data.certificates.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Award className="h-10 w-10 text-gold-500" />
          <p className="font-semibold text-parchment">No certificates yet</p>
          <p className="max-w-md text-sm text-parchment-muted">
            Complete every lesson of a video course to earn its certificate. For live Zoom, offline centre and e-book
            courses, the academy issues your certificate when you finish the training.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.certificates.map((c) => (
            <CertificateCard key={c.id} certificate={c} />
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold text-parchment">In progress</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {pending.map((c) => (
              <Link key={c.courseId} href={`/dashboard/courses/${c.courseId}`} className="card block p-4 transition hover:border-gold-500/50">
                <p className="font-semibold text-parchment">{c.title}</p>
                {c.mode === "admin" ? (
                  <p className="mt-1 text-xs text-parchment-muted">Issued by the academy when you complete the training.</p>
                ) : c.progress && c.progress.totalLessons > 0 ? (
                  <>
                    <div className="mt-2 flex items-center justify-between text-xs text-parchment-muted">
                      <span className="inline-flex items-center gap-1">
                        {c.progress.isComplete ? <Award className="h-3.5 w-3.5 text-emerald" /> : <Lock className="h-3.5 w-3.5" />}
                        {c.progress.isComplete
                          ? "Completed — open the course to download your certificate"
                          : `${c.progress.completedLessons} of ${c.progress.totalLessons} lessons`}
                      </span>
                      <span className="font-semibold text-parchment">{c.progress.percent}%</span>
                    </div>
                    <ProgressBar percent={c.progress.percent} className="mt-1.5" />
                  </>
                ) : (
                  <p className="mt-1 text-xs text-parchment-muted">Lessons are coming soon.</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CertificateCard({ certificate: c }: { certificate: CourseCertificate }) {
  const [copied, setCopied] = useState(false);
  const revoked = c.status === "REVOKED";

  function copy() {
    void navigator.clipboard?.writeText(c.certificateNo).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${revoked ? "bg-danger/10 text-danger" : "bg-gold-500/10 text-gold-500"}`}>
          <Award className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-parchment">{c.courseTitle}</p>
          <p className="mt-0.5 text-xs text-parchment-muted">Completed on {formatCertificateDate(c.completedAt)}</p>
        </div>
      </div>
      <button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-1.5 self-start rounded-lg bg-surface-hover px-2.5 py-1 font-mono text-xs font-semibold text-parchment" title="Copy certificate ID">
        {c.certificateNo} {copied ? <Check className="h-3.5 w-3.5 text-emerald" /> : <Copy className="h-3.5 w-3.5 text-parchment-muted" />}
      </button>
      {revoked ? (
        <p className="mt-4 text-sm font-semibold text-danger">This certificate has been revoked. Please contact support.</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={certificateFileUrl(c.certificateNo, "certificate.pdf")} className="btn-gold btn-sm">
            <Download className="h-4 w-4" /> Download PDF
          </a>
          <Link href={`/dashboard/certificates/${encodeURIComponent(c.certificateNo)}`} className="btn-outline btn-sm">
            <Eye className="h-4 w-4" /> View &amp; print
          </Link>
        </div>
      )}
    </div>
  );
}

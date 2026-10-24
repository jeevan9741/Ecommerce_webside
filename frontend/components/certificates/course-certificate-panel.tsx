"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Award, Download, Loader2, Lock } from "lucide-react";
import { ProgressBar } from "@/components/library/category-theme";
import { certificateFileUrl, certificateService, type CourseCertificate, type CourseProgress, type IssueMode } from "@/services/certificateService";

/**
 * Course page block: progress towards the certificate, and the Download Certificate button once
 * every lesson is complete. The server decides eligibility; this only shows its answer.
 */
export function CourseCertificatePanel({ courseId }: { courseId: string }) {
  const [state, setState] = useState<{ mode: IssueMode; progress: CourseProgress | null; certificate: CourseCertificate | null } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    certificateService
      .forCourse(courseId)
      .then(setState)
      .catch(() => setState(null));
  }, [courseId]);

  useEffect(() => {
    load();
    // Progress changes while the student watches in another tab; refresh when they come back.
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  if (!state) return null;
  const { mode, progress, certificate } = state;

  async function download() {
    setError(null);
    setClaiming(true);
    try {
      const { certificate: issued } = certificate ? { certificate } : await certificateService.claim(courseId);
      setState((s) => (s ? { ...s, certificate: issued } : s));
      window.location.href = certificateFileUrl(issued.certificateNo, "certificate.pdf");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get your certificate. Please try again.");
      load();
    } finally {
      setClaiming(false);
    }
  }

  // Admin-issued courses with nothing issued yet: just say how it works.
  if (mode === "admin" && !certificate) {
    return (
      <div className="card mt-6 flex items-start gap-3 p-5">
        <Award className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
        <div>
          <p className="font-semibold text-parchment">Course completion certificate</p>
          <p className="mt-1 text-sm text-parchment-muted">
            The academy issues your certificate once you complete this training. It will appear in{" "}
            <Link href="/dashboard/certificates" className="font-semibold text-gold-500 hover:underline">
              My Certificates
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
  if (mode === "auto" && !certificate && (!progress || progress.totalLessons === 0)) return null;

  const complete = Boolean(certificate) || Boolean(progress?.isComplete);
  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${complete ? "bg-emerald/10 text-emerald" : "bg-gold-500/10 text-gold-500"}`}>
            {complete ? <Award className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-parchment">{complete ? "Course completed — your certificate is ready" : "Course completion certificate"}</p>
            <p className="mt-0.5 text-sm text-parchment-muted">
              {certificate?.status === "REVOKED"
                ? "This certificate has been revoked. Please contact support."
                : certificate
                  ? `Certificate ID ${certificate.certificateNo}`
                  : complete
                    ? "Download it now — it's also saved in My Certificates."
                    : "Complete all lessons to unlock your certificate."}
            </p>
          </div>
        </div>
        {certificate?.status !== "REVOKED" && (
          <button type="button" onClick={download} disabled={!complete || claiming} className="btn-gold btn-sm shrink-0 self-start sm:self-center">
            {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : complete ? <Download className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            Download Certificate
          </button>
        )}
      </div>
      {progress && progress.totalLessons > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-parchment-muted">
            <span>
              {progress.completedLessons} of {progress.totalLessons} lessons completed
              {progress.language ? ` · ${progress.language.name}` : ""}
            </span>
            <span className="font-semibold text-parchment">{progress.percent}%</span>
          </div>
          <ProgressBar percent={progress.percent} className="mt-1.5" />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

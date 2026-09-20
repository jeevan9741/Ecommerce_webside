"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, FileDown } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type ApplicationStatus = "NEW" | "REVIEWED" | "SHORTLISTED" | "REJECTED" | "HIRED";

interface Application {
  id: string;
  applicantName: string;
  email: string;
  phone: string;
  coverNote: string | null;
  resumeUrl: string | null;
  status: ApplicationStatus;
  createdAt: string;
}

const STATUSES: ApplicationStatus[] = ["NEW", "REVIEWED", "SHORTLISTED", "REJECTED", "HIRED"];

export default function JobApplicationsPage() {
  const params = useParams<{ id: string }>();
  const [applications, setApplications] = useState<Application[] | null>(null);

  useEffect(() => {
    fetch(`/api/admin/jobs/${params.id}/applications`)
      .then((r) => r.json())
      .then((data) => setApplications(data.applications));
  }, [params.id]);

  async function updateStatus(id: string, status: ApplicationStatus) {
    setApplications((prev) => prev?.map((a) => (a.id === id ? { ...a, status } : a)) ?? null);
    await fetch(`/api/admin/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  if (!applications) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/jobs" className="btn-ghost !px-0 !py-0 text-sm">
        <ArrowLeft className="h-4 w-4" /> Back to Job Postings
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold text-parchment">Applications</h1>
      <p className="mt-1 text-sm text-parchment-muted">{applications.length} applicants</p>

      <div className="mt-6 space-y-3">
        {applications.map((a) => (
          <div key={a.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-parchment">{a.applicantName}</p>
                <p className="text-xs text-parchment-muted">
                  {a.email} · {a.phone} · {formatDateTime(a.createdAt)}
                </p>
                {a.coverNote && <p className="mt-2 max-w-xl text-sm text-parchment-muted">{a.coverNote}</p>}
              </div>
              <div className="flex items-center gap-2">
                {a.resumeUrl && (
                  <a href={a.resumeUrl} target="_blank" rel="noopener noreferrer" className="btn-outline !px-3 !py-1.5 text-xs">
                    <FileDown className="h-3.5 w-3.5" /> Resume
                  </a>
                )}
                <select
                  className="input-field !w-auto !py-1.5 text-xs"
                  value={a.status}
                  onChange={(e) => updateStatus(a.id, e.target.value as ApplicationStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
        {applications.length === 0 && (
          <p className="card p-8 text-center text-sm text-parchment-muted">No applications yet for this posting.</p>
        )}
      </div>
    </div>
  );
}

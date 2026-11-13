"use client";

import Link from "next/link";
import { PartnerTable } from "@/components/franchise/partner-table";
import { formatDateTime } from "@/lib/format";
import { progressLabel, type ProgressRow } from "@/lib/franchise-partner-views";

interface Row extends ProgressRow {
  id: string;
  studentReference: string;
  studentLinkId: string;
  studentName: string;
  courseTitle: string;
  lastActivityAt: string | null;
}

/** Learning progress of this franchise's own students, from the same rule students see on their own dashboard. */
export default function FranchiseProgressPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Learning progress</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Completed lessons out of each course&apos;s lessons, on the student&apos;s best language track. Where a course has no lessons to track, progress isn&apos;t shown.
        </p>
      </div>
      <PartnerTable<Row>
        endpoint="/franchise-partner/progress"
        rowsKey="progress"
        title="Progress"
        searchPlaceholder="Search student or course"
        rowKey={(r) => r.id}
        emptyText="No active enrolments yet, so there's no progress to show."
        columns={[
          {
            header: "Student",
            cell: (r) => (
              <>
                <Link href={`/franchise-partner/students/${r.studentLinkId}`} className="font-medium text-parchment hover:underline">
                  {r.studentName}
                </Link>
                <p className="text-xs text-parchment-muted">{r.studentReference}</p>
              </>
            ),
          },
          { header: "Course", cell: (r) => <span className="text-parchment">{r.courseTitle}</span> },
          {
            header: "Progress",
            className: "min-w-[220px]",
            cell: (r) => (
              <div>
                <p className={r.available ? "text-parchment" : "text-parchment-muted"}>{progressLabel(r)}</p>
                {r.available && r.percent !== null && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={r.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.studentName}, ${r.courseTitle}`}>
                    <div className="h-full rounded-full bg-gold-500" style={{ width: `${r.percent}%` }} />
                  </div>
                )}
              </div>
            ),
          },
          { header: "Last activity", cell: (r) => <span className="text-parchment-muted">{r.lastActivityAt ? formatDateTime(r.lastActivityAt) : "No activity recorded"}</span> },
        ]}
      />
    </div>
  );
}

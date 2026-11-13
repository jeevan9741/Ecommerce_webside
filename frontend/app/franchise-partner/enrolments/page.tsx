"use client";

import Link from "next/link";
import { PartnerTable } from "@/components/franchise/partner-table";
import { formatDate } from "@/lib/format";
import { ACCESS_STATUS_LABEL, ENROLMENT_STATUS_LABEL } from "@/lib/franchise-partner-views";

interface EnrolmentRow {
  id: string;
  studentReference: string;
  studentLinkId: string;
  studentName: string;
  courseTitle: string;
  enrolledAt: string;
  status: "ACTIVE" | "ENDED";
  accessStatus: "ACTIVE" | "REVOKED";
}

/** Course enrolments of this franchise's own students (the server scopes every row to this franchise). */
export default function FranchiseEnrolmentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Course enrolments</h1>
        <p className="mt-1 text-sm text-parchment-muted">Courses your students are enrolled in. Payment details are never shown here.</p>
      </div>
      <PartnerTable<EnrolmentRow>
        endpoint="/franchise-partner/enrolments"
        rowsKey="enrolments"
        title="Enrolments"
        searchPlaceholder="Search student or course"
        rowKey={(r) => r.id}
        emptyText="No enrolments yet. They appear here when your students enrol in a course."
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
          { header: "Enrolled", cell: (r) => <span className="text-parchment-muted">{formatDate(r.enrolledAt)}</span> },
          { header: "Status", cell: (r) => <span className={r.status === "ACTIVE" ? "text-emerald" : "text-parchment-muted"}>{ENROLMENT_STATUS_LABEL[r.status] ?? r.status}</span> },
          { header: "Course access", cell: (r) => <span className="text-parchment-muted">{ACCESS_STATUS_LABEL[r.accessStatus] ?? r.accessStatus}</span> },
        ]}
      />
    </div>
  );
}

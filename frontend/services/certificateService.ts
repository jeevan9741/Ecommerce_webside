import { api } from "@/lib/api";

export type CertificateStatus = "VALID" | "REVOKED";
export type IssueMode = "auto" | "admin";
export type CourseType = "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";

export interface CourseCertificate {
  id: string;
  certificateNo: string;
  studentName: string;
  courseTitle: string;
  courseId: string;
  completedAt: string;
  issuedAt: string;
  status: CertificateStatus;
}

export interface CourseProgress {
  totalLessons: number;
  completedLessons: number;
  percent: number;
  language: { code: string; name: string } | null;
  isComplete: boolean;
  completedAt: string | null;
}

export interface Signatory {
  name: string;
  title: string;
  /** Short-lived signed link; null when no signature image has been uploaded. */
  signatureUrl: string | null;
}

export interface MyCourseCertificateStatus {
  courseId: string;
  title: string;
  type: CourseType;
  mode: IssueMode;
  certificateNo: string | null;
  /** Video courses only. */
  progress: CourseProgress | null;
}

export type PublicCertificate = Omit<CourseCertificate, "id" | "courseId">;

export interface AdminCertificate extends CourseCertificate {
  email: string;
  issuedBy: "auto" | "admin";
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface AdminCertificateDetail extends AdminCertificate {
  courseType: CourseType;
  lessonCount: number;
  student: { id: string; email: string; phone: string | null; name: string };
  currentProgress: CourseProgress | null;
}

/** Where the PDF / PNG of a certificate is served (rendered by the Next.js route, not the API). */
export function certificateFileUrl(certificateNo: string, file: "certificate.pdf" | "certificate.png", download = true) {
  return `/certificates/${encodeURIComponent(certificateNo)}/${file}${download ? "" : "?download=0"}`;
}

export const certificateService = {
  mine: () => api.get<{ certificates: CourseCertificate[]; courses: MyCourseCertificateStatus[] }>("/me/certificates"),
  forCourse: (courseId: string) =>
    api.get<{ mode: IssueMode; progress: CourseProgress | null; certificate: CourseCertificate | null }>(`/me/courses/${courseId}/certificate`),
  claim: (courseId: string) => api.post<{ certificate: CourseCertificate }>(`/me/courses/${courseId}/certificate`),
  get: (certificateNo: string, token?: string | null) =>
    api.get<{ certificate: CourseCertificate; signatory: Signatory }>(
      `/me/certificates/${encodeURIComponent(certificateNo)}`,
      token !== undefined ? { token } : undefined
    ),
  verify: (certificateNo: string) =>
    api.get<{ certificate: PublicCertificate }>(`/public/certificates/${encodeURIComponent(certificateNo)}`, { token: null }),

  // Admin
  adminList: (q = "") => api.get<{ certificates: AdminCertificate[] }>(`/admin/course-certificates${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  adminGet: (certificateNo: string) =>
    api.get<{ certificate: AdminCertificateDetail }>(`/admin/course-certificates/${encodeURIComponent(certificateNo)}`),
  adminIssue: (body: { email: string; courseId: string; completedAt?: string }) =>
    api.post<{ certificate: CourseCertificate }>("/admin/course-certificates", body),
  adminRevoke: (id: string, reason: string) => api.post<{ certificate: CourseCertificate }>(`/admin/course-certificates/${id}/revoke`, { reason }),
  adminRestore: (id: string) => api.post<{ certificate: CourseCertificate }>(`/admin/course-certificates/${id}/restore`),
  settings: () => api.get<{ signatory: Signatory }>("/admin/certificate-settings"),
  saveSettings: (body: { name: string; title: string; signature?: string | null }) =>
    api.put<{ signatory: Signatory }>("/admin/certificate-settings", body),
};

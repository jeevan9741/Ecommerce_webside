import { api } from "@/lib/api";

/**
 * Admin API client. Every call is re-authorised by the backend (requireAdmin);
 * nothing here grants access by itself.
 */
export const adminService = {
  // Analytics
  salesAnalytics: () => api.get<Record<string, unknown>>("/admin/analytics/sales"),
  payoutAnalytics: () => api.get<Record<string, unknown>>("/admin/analytics/payouts"),

  // People
  customers: () => api.get<{ customers: unknown[] }>("/admin/customers"),
  partners: () => api.get<{ partners: unknown[] }>("/admin/partners"),

  // Orders
  orders: () => api.get<{ orders: unknown[] }>("/admin/orders"),
  syncOrder: (id: string) => api.post<Record<string, unknown>>(`/admin/orders/${id}/sync`),

  // Withdrawals
  withdrawals: () => api.get<{ withdrawals: unknown[] }>("/admin/withdrawals"),
  processWithdrawal: (id: string, body: { action: "SUCCESS" | "FAILED" | "PROCESSING"; providerRefId?: string; failureReason?: string }) =>
    api.post<{ withdrawal: unknown }>(`/admin/withdrawals/${id}/process`, body),

  // Settings
  settings: () => api.get<{ settings: unknown[] }>("/admin/settings"),
  saveSetting: (key: string, value: unknown) => api.put<{ setting: unknown }>("/admin/settings", { key, value }),

  // Courses
  courses: () => api.get<{ courses: unknown[] }>("/admin/courses"),
  createCourse: (data: unknown) => api.post<{ course: unknown }>("/admin/courses", data),
  updateCourse: (id: string, data: unknown) => api.patch<{ course: unknown }>(`/admin/courses/${id}`, data),
  deactivateCourse: (id: string) => api.delete(`/admin/courses/${id}`),
  courseLanguages: (id: string) => api.get<{ entries: unknown[] }>(`/admin/courses/${id}/languages`),
  saveCourseLanguage: (id: string, languageId: string, data: unknown) =>
    api.put<{ entry: unknown }>(`/admin/courses/${id}/languages/${languageId}`, data),
  removeCourseLanguage: (id: string, languageId: string) => api.delete(`/admin/courses/${id}/languages/${languageId}`),

  // Curriculum
  createModule: (courseId: string, title: string) => api.post<{ module: unknown }>(`/admin/courses/${courseId}/modules`, { title }),
  updateModule: (id: string, data: unknown) => api.patch<{ module: unknown }>(`/admin/modules/${id}`, data),
  deleteModule: (id: string) => api.delete(`/admin/modules/${id}`),
  createLesson: (moduleId: string, title: string) => api.post<{ lesson: unknown }>(`/admin/modules/${moduleId}/lessons`, { title }),
  updateLesson: (id: string, data: unknown) => api.put<{ lesson: unknown }>(`/admin/lessons/${id}`, data),
  deleteLesson: (id: string) => api.delete(`/admin/lessons/${id}`),
  previewLesson: (id: string) => api.get<{ videoUrl: string; subtitleUrl: string | null }>(`/admin/lessons/${id}/preview`),

  // Languages & demo videos
  languages: () => api.get<{ languages: unknown[] }>("/admin/languages"),
  createLanguage: (data: unknown) => api.post<{ language: unknown }>("/admin/languages", data),
  updateLanguage: (id: string, data: unknown) => api.patch<{ language: unknown }>(`/admin/languages/${id}`, data),
  demoVideos: () => api.get<{ videos: unknown[] }>("/admin/demo-videos"),
  saveDemoVideo: (languageId: string, storageKey: string) =>
    api.post<{ video: unknown }>("/admin/demo-videos", { languageId, storageKey }),
  deleteDemoVideo: (id: string) => api.delete(`/admin/demo-videos/${id}`),

  // Uploads
  presign: (filename: string, contentType: string, prefix: "course-content" | "demo-videos" | "certificates") =>
    api.post<{ uploadUrl: string; key: string }>("/upload/presign", { filename, contentType, prefix }),

  // Reviews, employees, jobs, certificates
  reviews: () => api.get<{ reviews: unknown[] }>("/admin/reviews"),
  createReview: (data: unknown) => api.post<{ review: unknown }>("/admin/reviews", data),
  updateReview: (id: string, data: unknown) => api.patch<{ review: unknown }>(`/admin/reviews/${id}`, data),
  deleteReview: (id: string) => api.delete(`/admin/reviews/${id}`),
  employees: () => api.get<{ employees: unknown[] }>("/admin/employees"),
  createEmployee: (data: unknown) => api.post<{ employee: unknown }>("/admin/employees", data),
  updateEmployee: (id: string, data: unknown) => api.patch<{ employee: unknown }>(`/admin/employees/${id}`, data),
  deleteEmployee: (id: string) => api.delete(`/admin/employees/${id}`),
  jobs: () => api.get<{ jobs: unknown[] }>("/admin/jobs"),
  createJob: (data: unknown) => api.post<{ job: unknown }>("/admin/jobs", data),
  updateJob: (id: string, data: unknown) => api.patch<{ job: unknown }>(`/admin/jobs/${id}`, data),
  deactivateJob: (id: string) => api.delete(`/admin/jobs/${id}`),
  jobApplications: (jobId: string) => api.get<{ applications: unknown[] }>(`/admin/jobs/${jobId}/applications`),
  updateApplication: (id: string, status: string) => api.patch<{ application: unknown }>(`/admin/applications/${id}`, { status }),
  certificates: () => api.get<{ certificates: unknown[] }>("/admin/certificates"),
  createCertificate: (data: unknown) => api.post<{ certificate: unknown }>("/admin/certificates", data),
  deleteCertificate: (id: string) => api.delete(`/admin/certificates/${id}`),
};

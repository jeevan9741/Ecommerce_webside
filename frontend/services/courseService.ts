import { api } from "@/lib/api";

export interface PublicDemoVideo {
  title: string;
  description: string | null;
  languageCode: string;
  languageName: string;
  durationSeconds: number | null;
  url: string;
  thumbnailUrl: string | null;
}

export const courseService = {
  list: () => api.get<{ courses: unknown[]; ownedCourseIds: string[] }>("/courses"),
  content: (courseId: string) => api.get<Record<string, unknown>>(`/courses/${courseId}/content`),
  languages: () => api.get<{ languages: { id: string; code: string; name: string; nativeName: string }[] }>("/languages"),
  demoVideo: (lang: string) =>
    api.get<{ video: PublicDemoVideo | null }>(
      `/demo-videos?lang=${encodeURIComponent(lang)}`
    ),
  reviews: () => api.get<{ reviews: unknown[] }>("/reviews"),
  publicSettings: () => api.get<{ settings: Record<string, unknown> }>("/settings/public"),
  certificates: () => api.get<{ certificates: unknown[] }>("/certificates"),
  jobs: () => api.get<{ jobs: unknown[] }>("/jobs"),
  job: (id: string) => api.get<{ job: unknown }>(`/jobs/${id}`),
  /** Multipart: applicantName, email, phone, coverNote, resume (file). */
  applyToJob: (jobId: string, form: FormData) =>
    api.post<{ ok: true; applicationId: string }>(`/jobs/${jobId}/apply`, form),
};

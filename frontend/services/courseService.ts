import { api } from "@/lib/api";

export interface PublicDemoVideo {
  title: string;
  description: string | null;
  /** Missing from older API versions. */
  platform?: { slug: string; name: string };
  /** True when the requested language has no demo yet and this is the English version. */
  languageFallback: boolean;
  languageCode: string;
  languageName: string;
  durationSeconds: number | null;
  url: string;
  thumbnailUrl: string | null;
}

/** A platform card in the homepage demo section, with what's available in the visitor's language. */
export interface DemoPlatform {
  slug: string;
  name: string;
  description: string | null;
  status: "available" | "fallback" | "none";
}

export const courseService = {
  list: () => api.get<{ courses: unknown[]; ownedCourseIds: string[] }>("/courses"),
  content: (courseId: string) => api.get<Record<string, unknown>>(`/courses/${courseId}/content`),
  languages: () => api.get<{ languages: { id: string; code: string; name: string; nativeName: string }[] }>("/languages"),
  demoPlatforms: (lang: string) =>
    api.get<{ platforms: DemoPlatform[] }>(`/demo-platforms?lang=${encodeURIComponent(lang)}`, { token: null }),
  demoVideo: (lang: string, platform: string) =>
    api.get<{ video: PublicDemoVideo | null }>(
      `/demo-videos?lang=${encodeURIComponent(lang)}&platform=${encodeURIComponent(platform)}`,
      { token: null }
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

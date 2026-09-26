import { api } from "@/lib/api";

export interface VideoProgress {
  positionSeconds: number;
  maxPositionSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export interface VideoLanguage {
  code: string;
  name: string;
}

export interface AdminVideo {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  categoryId: string | null;
  category: { id: string; name: string; parentName: string | null } | null;
  languageId: string | null;
  language: VideoLanguage | null;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  displayOrder: number;
  isPublished: boolean;
  thumbnailUrl: string | null;
  hasThumbnail: boolean;
  viewers: number;
  completions: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudentVideo {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  language: VideoLanguage | null;
  thumbnailUrl: string | null;
  progress: VideoProgress | null;
}

export interface WatchPayload {
  video: {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number | null;
    mimeType: string;
    thumbnailUrl: string | null;
    course: { id: string; title: string } | null;
  };
  /** Where the playlist comes from: the package page or a category in the Course Library. */
  context:
    | { kind: "course"; title: string; courseId: string }
    | { kind: "category"; title: string; categorySlug: string; sectionSlug: string };
  streamUrl: string;
  expiresAt: string;
  progress: VideoProgress | null;
  playlist: { id: string; title: string; durationSeconds: number | null; progress: VideoProgress | null }[];
}

export interface VideoEdit {
  title?: string;
  description?: string | null;
  courseId?: string | null;
  categoryId?: string | null;
  languageId?: string | null;
  thumbnailKey?: string | null;
  /** A new upload replaces the video file (students keep their progress). */
  storageKey?: string;
  durationSeconds?: number | null;
  isPublished?: boolean;
  displayOrder?: number;
}

/** The free demo for one language, shown on the homepage without login. */
export interface AdminDemoVideo {
  id: string;
  languageId: string;
  language: VideoLanguage & { id: string; nativeName: string; isActive: boolean };
  title: string;
  description: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  isPublic: boolean;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoVideoEdit {
  title?: string;
  description?: string | null;
  languageId?: string;
  storageKey?: string;
  thumbnailKey?: string | null;
  durationSeconds?: number | null;
}

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;

export const videoService = {
  // Admin
  uploadToken: (body: { kind: "video" | "thumbnail"; purpose: "course" | "demo"; filename: string; contentType: string; sizeBytes: number }) =>
    api.post<{ pathname: string; clientToken: string; access: "private" | "public" }>("/admin/videos/upload-token", body),
  discardUpload: (key: string) => api.post<{ ok: true }>("/admin/videos/discard-upload", { key }),
  list: (params: { courseId?: string; categoryId?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.courseId) qs.set("courseId", params.courseId);
    if (params.categoryId) qs.set("categoryId", params.categoryId);
    if (params.q) qs.set("q", params.q);
    return api.get<{ videos: AdminVideo[] }>(`/admin/videos${qs.size ? `?${qs}` : ""}`);
  },
  create: (body: VideoEdit & { title: string; storageKey: string; durationSeconds?: number | null }) =>
    api.post<{ video: AdminVideo }>("/admin/videos", body),
  update: (id: string, body: VideoEdit) => api.patch<{ video: AdminVideo }>(`/admin/videos/${id}`, body),
  remove: (id: string) => api.delete<{ ok: true }>(`/admin/videos/${id}`),
  preview: (id: string) => api.get<{ streamUrl: string; expiresAt: string }>(`/admin/videos/${id}/preview`),
  demos: () => api.get<{ videos: AdminDemoVideo[] }>("/admin/demo-videos"),
  createDemo: (body: DemoVideoEdit & { title: string; languageId: string; storageKey: string }) =>
    api.post<{ video: AdminDemoVideo }>("/admin/demo-videos", body),
  updateDemo: (id: string, body: DemoVideoEdit) => api.patch<{ video: AdminDemoVideo }>(`/admin/demo-videos/${id}`, body),
  removeDemo: (id: string) => api.delete<{ ok: true }>(`/admin/demo-videos/${id}`),

  // Students
  courseVideos: (courseId: string) => api.get<{ videos: StudentVideo[] }>(`/me/courses/${courseId}/videos`),
  watch: (id: string, context: "course" | "category" = "course") => api.get<WatchPayload>(`/me/videos/${id}?context=${context}`),
  /** `keepalive` lets the final save survive the page being closed. */
  saveProgress: (id: string, body: { positionSeconds: number; durationSeconds?: number; completed?: boolean }, keepalive = false) =>
    api.put<{ progress: VideoProgress }>(`/me/videos/${id}/progress`, body, keepalive ? { keepalive: true } : undefined),
};

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 0–100, from the furthest point reached. */
export function progressPercent(progress: VideoProgress | null, durationSeconds: number | null) {
  if (!progress) return 0;
  if (progress.completed) return 100;
  if (!durationSeconds) return 0;
  return Math.min(99, Math.round((progress.maxPositionSeconds / durationSeconds) * 100));
}

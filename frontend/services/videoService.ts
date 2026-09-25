import { api } from "@/lib/api";

export interface VideoProgress {
  positionSeconds: number;
  maxPositionSeconds: number;
  completed: boolean;
  updatedAt: string;
}

export interface AdminVideo {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
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
    course: { id: string; title: string };
  };
  streamUrl: string;
  expiresAt: string;
  progress: VideoProgress | null;
  playlist: { id: string; title: string; durationSeconds: number | null; progress: VideoProgress | null }[];
}

export interface VideoEdit {
  title?: string;
  description?: string | null;
  courseId?: string | null;
  thumbnailKey?: string | null;
  isPublished?: boolean;
  displayOrder?: number;
}

export const MAX_VIDEO_BYTES = 2 * 1024 ** 3;

export const videoService = {
  // Admin
  uploadToken: (body: { kind: "video" | "thumbnail"; filename: string; contentType: string; sizeBytes: number }) =>
    api.post<{ pathname: string; clientToken: string }>("/admin/videos/upload-token", body),
  discardUpload: (key: string) => api.post<{ ok: true }>("/admin/videos/discard-upload", { key }),
  list: (params: { courseId?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.courseId) qs.set("courseId", params.courseId);
    if (params.q) qs.set("q", params.q);
    return api.get<{ videos: AdminVideo[] }>(`/admin/videos${qs.size ? `?${qs}` : ""}`);
  },
  create: (body: VideoEdit & { title: string; storageKey: string; durationSeconds?: number | null }) =>
    api.post<{ video: AdminVideo }>("/admin/videos", body),
  update: (id: string, body: VideoEdit) => api.patch<{ video: AdminVideo }>(`/admin/videos/${id}`, body),
  remove: (id: string) => api.delete<{ ok: true }>(`/admin/videos/${id}`),
  preview: (id: string) => api.get<{ streamUrl: string; expiresAt: string }>(`/admin/videos/${id}/preview`),

  // Students
  courseVideos: (courseId: string) => api.get<{ videos: StudentVideo[] }>(`/me/courses/${courseId}/videos`),
  watch: (id: string) => api.get<WatchPayload>(`/me/videos/${id}`),
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

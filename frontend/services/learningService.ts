import { api } from "@/lib/api";
import type { LiveSessionState } from "@/lib/live-session";

/** A package as the locked / "coming soon" screens show it. */
export interface PackageSummary {
  id: string;
  title: string;
  type: "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";
  priceInPaise: number;
}

export interface StudentEBook {
  id: string;
  title: string;
  description: string | null;
  format: string;
  sizeBytes: number;
  course: { id: string; title: string };
  category: { name: string } | null;
  updatedAt: string;
}

export interface AdminEBook extends StudentEBook {
  courseId: string;
  categoryId: string | null;
  fileName: string;
  mimeType: string;
  displayOrder: number;
  isPublished: boolean;
  createdAt: string;
}

export interface EBookEdit {
  title?: string;
  description?: string | null;
  courseId?: string;
  categoryId?: string | null;
  isPublished?: boolean;
  displayOrder?: number;
  /** A new upload replaces the file (send with fileName). */
  storageKey?: string;
  fileName?: string;
}

export interface StudentLiveSession {
  id: string;
  course: { id: string; title: string };
  dayNumber: number;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  joinOpensAt: string;
  state: LiveSessionState;
  canJoin: boolean;
  cancelReason: string | null;
  updatedAt: string;
}

export interface AdminLiveSession extends StudentLiveSession {
  courseId: string;
  joinUrl: string;
  joinOpensMinutesBefore: number;
  isPublished: boolean;
  status: "SCHEDULED" | "CANCELLED";
  cancelledAt: string | null;
  date: string;
  startTime: string;
  endTime: string;
  createdAt: string;
}

export interface LiveSessionInput {
  courseId: string;
  dayNumber: number;
  title: string;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  joinUrl: string;
  joinOpensMinutesBefore: number;
  isPublished: boolean;
}

export const ACCEPTED_EBOOK_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/epub+zip": ".epub",
};
export const MAX_EBOOK_BYTES = 100 * 1024 ** 2;

const withCourse = (path: string, courseId?: string) => (courseId ? `${path}?courseId=${encodeURIComponent(courseId)}` : path);

export const learningService = {
  // Students
  myEBooks: (courseId?: string) =>
    api.get<{ ebooks: StudentEBook[]; packages: PackageSummary[]; unlock: PackageSummary[] }>(withCourse("/me/ebooks", courseId)),
  downloadEBook: (id: string) => api.post<{ url: string; fileName: string; expiresAt: string }>(`/me/ebooks/${id}/download`),
  myLiveSessions: (courseId?: string) =>
    api.get<{ sessions: StudentLiveSession[]; packages: PackageSummary[]; unlock: PackageSummary[]; serverTime: string }>(
      withCourse("/me/live-sessions", courseId)
    ),
  joinLiveSession: (id: string) => api.post<{ joinUrl: string }>(`/me/live-sessions/${id}/join`),

  // Admin: e-books
  ebookUploadToken: (body: { filename: string; contentType: string; sizeBytes: number }) =>
    api.post<{ pathname: string; clientToken: string; access: "private" }>("/admin/ebooks/upload-token", body),
  discardEBookUpload: (key: string) => api.post<{ ok: true }>("/admin/ebooks/discard-upload", { key }),
  adminEBooks: (courseId?: string) => api.get<{ ebooks: AdminEBook[] }>(withCourse("/admin/ebooks", courseId)),
  createEBook: (body: EBookEdit & { title: string; courseId: string; storageKey: string; fileName: string }) =>
    api.post<{ ebook: AdminEBook }>("/admin/ebooks", body),
  updateEBook: (id: string, body: EBookEdit) => api.patch<{ ebook: AdminEBook }>(`/admin/ebooks/${id}`, body),
  removeEBook: (id: string) => api.delete<{ ok: true }>(`/admin/ebooks/${id}`),

  // Admin: live sessions
  adminLiveSessions: (courseId?: string) =>
    api.get<{ sessions: AdminLiveSession[]; trainingDays: number; defaultTimezone: string }>(withCourse("/admin/live-sessions", courseId)),
  createLiveSession: (body: LiveSessionInput) => api.post<{ session: AdminLiveSession }>("/admin/live-sessions", body),
  updateLiveSession: (id: string, body: Partial<LiveSessionInput>) => api.patch<{ session: AdminLiveSession }>(`/admin/live-sessions/${id}`, body),
  cancelLiveSession: (id: string, reason: string | null) => api.post<{ session: AdminLiveSession }>(`/admin/live-sessions/${id}/cancel`, { reason }),
  restoreLiveSession: (id: string) => api.post<{ session: AdminLiveSession }>(`/admin/live-sessions/${id}/restore`),
  removeLiveSession: (id: string) => api.delete<{ ok: true }>(`/admin/live-sessions/${id}`),
};

/**
 * Opens a link we only get after an async check (signed download, Zoom join) in a new tab. The tab is
 * opened during the click itself so mobile browsers don't block it as a popup, then pointed at the
 * link once it arrives — or closed if the check fails.
 */
export async function openAfter(getUrl: () => Promise<string>) {
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) {
      tab.opener = null;
      tab.location.replace(url);
    } else {
      window.location.assign(url);
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}

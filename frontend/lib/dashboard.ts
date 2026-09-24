// Server-only data helpers for the student portal pages (serverApi reads the session cookie).
import { serverApi } from "./session";
import { formatDate } from "./format";
import type { EnrolledAccess } from "@/components/dashboard/enrolled-packages";

export interface DashboardSummary {
  languages: { code: string; name: string; nativeName: string }[];
  user: {
    id: string;
    name: string;
    email: string;
    username: string;
    phone: string | null;
    createdAt: string;
    preferredLanguageCode: string | null;
  };
}

/** Profile + language list for the signed-in student, with the formatted join date. */
export async function getDashboardSummary() {
  const summary = await serverApi<DashboardSummary>("/me/dashboard");
  return { ...summary, memberSince: formatDate(summary.user.createdAt) };
}

/** Only live (purchased, not revoked) course access — the backend filters out everything else. */
export async function getEnrolledAccess(): Promise<EnrolledAccess[]> {
  const { access } = await serverApi<{ access: EnrolledAccess[] }>("/me/courses");
  return access;
}

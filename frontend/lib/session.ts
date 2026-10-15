// Server-only by construction: next/headers throws if this is ever imported into a client component.
import { cache } from "react";
import { cookies } from "next/headers";
import { api, ApiError, TOKEN_COOKIE } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  referralCode: string;
}

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

/**
 * Validates the cookie's token with the backend (the cookie alone is never trusted —
 * anyone can edit it). Cached per request so a layout and page can both call it for free.
 */
export const getSession = cache(async (): Promise<{ user: SessionUser; token: string } | null> => {
  const token = await getToken();
  if (!token) return null;
  try {
    const { user } = await api.get<{ user: SessionUser }>("/auth/session", { token });
    return { user, token };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
});

/** Server Component fetch with the current user's token attached. */
export async function serverApi<T>(path: string): Promise<T> {
  const token = await getToken();
  return api.get<T>(path, { token });
}

/**
 * Whether this account may see the student dashboard: admins always, everyone else only once
 * they hold a live course. The backend enforces the same rule on /me/dashboard and friends —
 * this call just lets the UI redirect instead of rendering a shell that would 403.
 */
export async function hasCourseAccess(user: SessionUser): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  const { ownedCourseIds } = await catalogue();
  return ownedCourseIds.length > 0;
}

type PackageType = "EBOOK" | "VIDEO" | "ZOOM" | "CENTRE";

/** The catalogue with the viewer's paid packages — fetched once per request however many helpers ask. */
const catalogue = cache(() => serverApi<{ courses: { id: string; type: PackageType }[]; ownedCourseIds: string[] }>("/courses"));

/**
 * Types of the packages this account has paid for (admins: all), so the dashboard only lists
 * sections the student can open. Display only — every section's API re-checks the purchase.
 */
export async function ownedPackageTypes(user: SessionUser): Promise<Set<PackageType>> {
  if (user.role === "ADMIN") return new Set(["EBOOK", "VIDEO", "ZOOM", "CENTRE"]);
  const { courses, ownedCourseIds } = await catalogue();
  const owned = new Set(ownedCourseIds);
  return new Set(courses.filter((c) => owned.has(c.id)).map((c) => c.type));
}

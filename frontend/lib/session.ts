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

/**
 * Single HTTP client for talking to the Express backend. Works in both client
 * components (token read from the cookie automatically) and Server Components
 * (pass the token explicitly — see lib/session.ts).
 */

import { API_URL } from "./site";

export { API_URL };

/** First-party cookie holding the backend JWT. Readable by JS so requests can send it as a Bearer token. */
export const TOKEN_COOKIE = "eca_token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function readClientToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

type Options = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Server Components pass the token they read from cookies(); client calls omit this. */
  token?: string | null;
};

export async function apiFetch<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { body, token, headers, ...rest } = options;
  const authToken = token !== undefined ? token : readClientToken();
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    cache: rest.cache ?? "no-store",
    headers: {
      ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, typeof data.error === "string" ? data.error : `Request failed (${res.status})`, data);
  }
  return data as T;
}

/**
 * Drop-in replacement for fetch() for code written against the old same-origin
 * `/api/*` routes. Same signature and same Response return value, so existing
 * `res.ok` / `res.json()` handling is unchanged — it just routes to the backend
 * (whose paths match the old ones exactly) and attaches the session token.
 */
export function backendFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = input.startsWith("/api") ? `${API_URL}${input}` : input;
  const token = readClientToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export const api = {
  get: <T = unknown>(path: string, opts?: Options) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, opts?: Options) => apiFetch<T>(path, { ...opts, method: "POST", body }),
  put: <T = unknown>(path: string, body?: unknown, opts?: Options) => apiFetch<T>(path, { ...opts, method: "PUT", body }),
  patch: <T = unknown>(path: string, body?: unknown, opts?: Options) => apiFetch<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T = unknown>(path: string, opts?: Options) => apiFetch<T>(path, { ...opts, method: "DELETE" }),
};

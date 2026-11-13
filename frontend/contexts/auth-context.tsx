"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, readClientToken, TOKEN_COOKIE } from "@/lib/api";
import { authService, type SessionUser } from "@/services/authService";

type Status = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: SessionUser | null;
  status: Status;
  login: (
    identifier: string,
    password: string
  ) => Promise<{ ok: true; user: SessionUser; mfaEnrollmentRequired: boolean } | { ok: false; mfaRequired: true; challengeToken: string } | { ok: false; mfaRequired?: false; error: string }>;
  /** Completes an admin sign-in with an authenticator code or a recovery code. */
  verifyMfa: (
    challengeToken: string,
    answer: { code: string } | { recoveryCode: string }
  ) => Promise<{ ok: true; user: SessionUser; recoveryCodesRemaining: number } | { ok: false; error: string; code?: string }>;
  /** Stores a session issued elsewhere (e.g. registration returns a token directly). */
  setSession: (token: string, user: SessionUser) => void;
  logout: (redirectTo?: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SEVEN_DAYS = 7 * 24 * 60 * 60;

function writeTokenCookie(token: string | null) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = token
    ? `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${SEVEN_DAYS}; samesite=lax${secure}`
    : `${TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Validate any stored token once on load; the backend is the source of truth.
  useEffect(() => {
    const hasToken = Boolean(readClientToken());
    Promise.resolve(hasToken ? authService.session() : null)
      .then((result) => {
        setUser(result?.user ?? null);
        setStatus(result ? "authenticated" : "unauthenticated");
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) writeTokenCookie(null);
        setUser(null);
        setStatus("unauthenticated");
      });
  }, []);

  const setSession = useCallback((token: string, nextUser: SessionUser) => {
    writeTokenCookie(token);
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  const login = useCallback<AuthContextValue["login"]>(
    async (identifier, password) => {
      try {
        const res = await authService.login(identifier, password);
        if ("mfaRequired" in res) return { ok: false, mfaRequired: true, challengeToken: res.challengeToken };
        setSession(res.token, res.user);
        return { ok: true, user: res.user, mfaEnrollmentRequired: Boolean(res.mfaEnrollmentRequired) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Login failed. Please try again." };
      }
    },
    [setSession]
  );

  const verifyMfa = useCallback<AuthContextValue["verifyMfa"]>(
    async (challengeToken, answer) => {
      try {
        const res = await authService.verifyMfa(challengeToken, answer);
        setSession(res.token, res.user);
        return { ok: true, user: res.user, recoveryCodesRemaining: res.recoveryCodesRemaining };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Verification failed. Please try again.", code: err instanceof ApiError ? (err.data.code as string | undefined) : undefined };
      }
    },
    [setSession]
  );

  const logout = useCallback((redirectTo = "/") => {
    writeTokenCookie(null);
    try {
      // Drop any half-finished signup's email verification so it can't carry over to the next visitor.
      sessionStorage.removeItem("eca_email_verification");
    } catch {
      // storage unavailable — nothing to clear
    }
    setUser(null);
    setStatus("unauthenticated");
    // Full navigation so Server Components re-render without the session.
    window.location.href = redirectTo;
  }, []);

  const value = useMemo(() => ({ user, status, login, verifyMfa, setSession, logout }), [user, status, login, verifyMfa, setSession, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { useAuth } from "@/contexts/auth-context";

/**
 * Admin sign-in: password, then the 6-digit code from the admin's authenticator app (or a one-time recovery
 * code). An admin who hasn't set up two-step verification yet is taken to set it up.
 */
function AdminLogin() {
  const router = useRouter();
  const { login, verifyMfa, logout } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const reason = useSearchParams().get("reason");
  const [error, setError] = useState<string | null>(reason === "mfa" ? "Please sign in again with your authenticator code." : null);

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await login(identifier, password);
    setBusy(false);
    if (!res.ok) {
      if (res.mfaRequired) {
        setPassword("");
        setChallenge(res.challengeToken);
        return;
      }
      setError(res.error);
      return;
    }
    if (res.user.role !== "ADMIN") {
      setError("This account does not have admin access.");
      logout("/admin/login");
      return;
    }
    router.push(res.mfaEnrollmentRequired ? "/admin/mfa" : "/admin");
    router.refresh();
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    const value = code.trim();
    if (!useRecovery && !/^\d{6}$/.test(value)) return setError("Enter the 6-digit code from your authenticator app.");
    if (useRecovery && value.replace(/[\s-]/g, "").length !== 12) return setError("Enter one of your 12-character recovery codes.");
    setBusy(true);
    const res = await verifyMfa(challenge, useRecovery ? { recoveryCode: value } : { code: value });
    setBusy(false);
    if (!res.ok) {
      if (res.code === "MFA_CHALLENGE_INVALID") {
        setChallenge(null);
        setCode("");
      }
      setError(res.error);
      return;
    }
    router.push(res.recoveryCodesRemaining <= 3 ? "/admin/mfa?low=1" : "/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-5 py-12">
      <LogoMark className="mb-8" />
      <div className="w-full max-w-md card p-8">
        <div className="mb-6 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-gold-500" />
          <h1 className="font-display text-2xl font-semibold text-parchment">Admin Login</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            {challenge ? "Step 2 of 2: two-step verification" : "Restricted access — authorized personnel only."}
          </p>
        </div>
        {!challenge ? (
          <form onSubmit={onPassword} className="space-y-4">
            <div>
              <label className="label-field" htmlFor="admin-identifier">Admin Email or Username</label>
              <input id="admin-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoComplete="username" className="input-field" />
            </div>
            <div>
              <label className="label-field" htmlFor="admin-password">Password</label>
              <PasswordInput id="admin-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="input-field" />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="btn-gold w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Signing in" /> : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={onCode} className="space-y-4" noValidate>
            <div>
              <label className="label-field" htmlFor="admin-code">{useRecovery ? "Recovery code" : "Authenticator code"}</label>
              <input
                id="admin-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={useRecovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={useRecovery ? 20 : 6}
                className="input-field tracking-widest"
                placeholder={useRecovery ? "XXXX-XXXX-XXXX" : "123456"}
                aria-describedby="admin-code-help"
                autoFocus
              />
              <p id="admin-code-help" className="mt-1 text-xs text-parchment-muted">
                {useRecovery ? "Each recovery code works once." : "Open your authenticator app and enter the current 6-digit code for ETA Admin."}
              </p>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="btn-gold w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Verifying" /> : "Verify and sign in"}
            </button>
            <div className="flex justify-between text-xs">
              <button type="button" className="text-gold-400 hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(null); }}>
                {useRecovery ? "Use my authenticator app instead" : "I can't use my authenticator — use a recovery code"}
              </button>
              <button type="button" className="text-parchment-muted hover:underline" onClick={() => { setChallenge(null); setCode(""); setError(null); }}>
                Start again
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** The page reads the address (?reason, ?low), so it renders inside Suspense (required for static pre-rendering). */
export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLogin />
    </Suspense>
  );
}

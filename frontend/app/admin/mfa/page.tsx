"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Loader2, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { groupSecret } from "@/lib/admin-mfa";

interface Status {
  enforced: boolean;
  enrolled: boolean;
  pending: boolean;
  sessionVerified: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * Admin two-step verification: set it up (password → authenticator → confirm → recovery codes), or, once
 * set up and signed in with it, see how many recovery codes are left and replace them.
 */
function AdminMfa() {
  const router = useRouter();
  const low = useSearchParams().get("low") === "1";
  const { setSession, logout } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string; account: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => api.get<Status>("/auth/mfa/status").then(setStatus, (e) => setError(e instanceof ApiError && e.status === 401 ? "Sign in first." : message(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setEnrol(await api.post<{ secret: string; otpauthUri: string; account: string }>("/auth/mfa/enroll/start", { password }));
      setPassword("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code your authenticator app shows.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recoveryCodes: string[]; token: string; user: Parameters<typeof setSession>[1] }>("/auth/mfa/enroll/confirm", { code: code.trim() });
      setSession(res.token, res.user);
      setCodes(res.recoveryCodes);
      setEnrol(null);
      setCode("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the current 6-digit code from your authenticator app.");
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>("/admin/security/mfa/recovery-codes", { code: code.trim() });
      setCodes(res.recoveryCodes);
      setSaved(false);
      setCode("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-ink px-5 py-12">
      <LogoMark className="mb-8" />
      <div className="card w-full max-w-lg space-y-5 p-8">
        <div className="text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-gold-500" aria-hidden="true" />
          <h1 className="font-display text-2xl font-semibold text-parchment">Two-step verification</h1>
          <p className="mt-1 text-sm text-parchment-muted">Admin accounts sign in with a password and a code from an authenticator app.</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}
        {!status && !error && <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}

        {codes ? (
          <section aria-labelledby="codes-title" className="space-y-3">
            <h2 id="codes-title" className="font-display text-lg font-semibold text-parchment">Your recovery codes</h2>
            <p className="text-sm text-parchment-muted">
              Each code signs you in once if you can&apos;t use your authenticator. Store them somewhere safe and offline. They won&apos;t be shown again.
            </p>
            <ol className="grid grid-cols-2 gap-2 rounded-lg bg-black/20 p-4 font-mono text-sm text-parchment">
              {codes.map((c) => <li key={c}>{c}</li>)}
            </ol>
            <button type="button" className="btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy codes
            </button>
            <label className="flex items-start gap-3 text-sm text-parchment">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
              <span>I have saved these recovery codes.</span>
            </label>
            <button type="button" className="btn-gold w-full" disabled={!saved} onClick={() => { router.push("/admin"); router.refresh(); }}>
              Continue to the admin dashboard
            </button>
          </section>
        ) : status && !status.enrolled ? (
          enrol ? (
            <form onSubmit={confirm} className="space-y-4" noValidate>
              <h2 className="font-display text-lg font-semibold text-parchment">Step 2: add ETA Admin to your authenticator</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-parchment-muted">
                <li>Open an authenticator app (for example Google Authenticator, Microsoft Authenticator or 1Password).</li>
                <li>Choose to add an account by entering a setup key, and enter this key (time-based):</li>
              </ol>
              <p className="break-all rounded-lg bg-black/20 p-3 text-center font-mono text-base tracking-wider text-parchment" aria-label="Setup key">{groupSecret(enrol.secret)}</p>
              <p className="text-xs text-parchment-muted">
                Account: {enrol.account}. On a phone you can also <a href={enrol.otpauthUri} className="text-gold-400 underline">open this setup link</a> in the app. Keep the key private.
              </p>
              <div>
                <label className="label-field" htmlFor="mfa-code">Step 3: enter the 6-digit code the app shows</label>
                <input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input-field tracking-widest" />
              </div>
              <button type="submit" className="btn-gold w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Verifying" /> : "Confirm and turn on"}</button>
            </form>
          ) : (
            <form onSubmit={start} className="space-y-4">
              {status.enforced && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-parchment">Two-step verification is required before you can use the admin dashboard.</p>}
              <div>
                <label className="label-field" htmlFor="mfa-password">Step 1: confirm your password</label>
                <PasswordInput id="mfa-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="input-field" />
              </div>
              <button type="submit" className="btn-gold w-full" disabled={busy || !password}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Checking" /> : "Continue"}</button>
            </form>
          )
        ) : status && status.enrolled && !status.sessionVerified ? (
          <div className="space-y-3 text-sm text-parchment-muted">
            <p>Two-step verification is set up for this account. Sign in again with your authenticator code to continue.</p>
            <button type="button" className="btn-gold w-full" onClick={() => logout("/admin/login")}>Sign in again</button>
          </div>
        ) : status ? (
          <form onSubmit={regenerate} className="space-y-4" noValidate>
            <p className="text-sm text-parchment">Two-step verification is on{status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}.</p>
            <p className={`text-sm ${status.recoveryCodesRemaining <= 3 || low ? "text-danger" : "text-parchment-muted"}`}>
              {status.recoveryCodesRemaining} recovery code{status.recoveryCodesRemaining === 1 ? "" : "s"} left.{status.recoveryCodesRemaining <= 3 ? " Create new ones now." : ""}
            </p>
            <div>
              <label className="label-field" htmlFor="mfa-regen-code">Current authenticator code</label>
              <input id="mfa-regen-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input-field tracking-widest" />
            </div>
            <button type="submit" className="btn-outline w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Creating" /> : "Create new recovery codes (old ones stop working)"}</button>
            <p className="text-xs text-parchment-muted">
              Lost your phone and your codes? Two other admins can reset your two-step verification from <Link href="/admin/security" className="text-gold-400 underline">Admin Security</Link>.
            </p>
            <Link href="/admin" className="btn-ghost btn-sm inline-flex">Back to the dashboard</Link>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/** The page reads the address (?reason, ?low), so it renders inside Suspense (required for static pre-rendering). */
export default function AdminMfaPage() {
  return (
    <Suspense fallback={null}>
      <AdminMfa />
    </Suspense>
  );
}

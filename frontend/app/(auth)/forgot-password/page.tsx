"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { authService } from "@/services/authService";
import { PasswordInput } from "@/components/password-input";
import { useAuth } from "@/contexts/auth-context";
import { postLoginPath } from "@/lib/routes";

const SUCCESS_SCREEN_MS = 1500;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { setSession } = useAuth();

  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function requestCode(isResend: boolean) {
    setError(null);
    if (isResend) setResending(true);
    else setBusy(true);
    try {
      const data = await authService.forgotPassword(email);
      setCodeSent(true);
      setCode("");
      setCooldown(typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : 60);
    } catch (err) {
      if (err instanceof ApiError && typeof err.data.retryAfterSeconds === "number") {
        setCooldown(err.data.retryAfterSeconds);
      }
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setBusy(false);
      setResending(false);
    }
  }

  function sendCode(e: FormEvent) {
    e.preventDefault();
    requestCode(false);
  }

  function startOver() {
    setCodeSent(false);
    setCode("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { token, user } = await authService.resetPassword(email, code, password);
      setSession(token, user);
      setDone(true);
      setTimeout(() => {
        router.replace(postLoginPath(user.role, null));
        router.refresh();
      }, SUCCESS_SCREEN_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-8 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald" />
        <h1 className="font-display text-2xl font-semibold text-parchment">Password changed</h1>
        <p className="mt-1 text-sm text-parchment-muted">You&apos;re signed in. Taking you to your dashboard…</p>
        <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="card p-8">
      <div className="mb-6 text-center">
        <KeyRound className="mx-auto mb-3 h-8 w-8 text-gold-500" />
        <h1 className="font-display text-2xl font-semibold text-parchment">Reset your password</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          {codeSent ? "Enter the code from your email and choose a new password." : "We'll email you a 6-digit code to reset it."}
        </p>
      </div>

      {!codeSent ? (
        <form onSubmit={sendCode} className="space-y-4">
          <div>
            <label className="label-field">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy} className="btn-gold w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Reset Code"}
          </button>
        </form>
      ) : (
        <form onSubmit={resetPassword} className="space-y-4">
          <p className="text-sm text-parchment-muted">
            If <span className="text-parchment">{email}</span> has an account, a code is on its way.{" "}
            <button type="button" onClick={startOver} className="text-xs font-medium text-gold-500 hover:text-gold-400">
              Change
            </button>
          </p>
          <div>
            <label className="label-field">Code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input-field tracking-[0.4em]"
              placeholder="123456"
            />
          </div>
          <div>
            <label className="label-field">New Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              className="input-field"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="label-field">Confirm New Password</label>
            <PasswordInput
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              className="input-field"
              placeholder="Type it again"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className="btn-gold w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset Password"}
          </button>
          <button
            type="button"
            onClick={() => requestCode(true)}
            disabled={resending || cooldown > 0}
            className="btn-ghost w-full !py-2 text-xs disabled:opacity-50"
          >
            {resending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : cooldown > 0 ? (
              `Resend code in ${cooldown}s`
            ) : (
              "Resend code"
            )}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-parchment-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-gold-500 hover:text-gold-400">
          Back to login
        </Link>
      </p>
    </div>
  );
}

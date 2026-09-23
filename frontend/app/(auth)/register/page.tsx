"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, UserPlus, CheckCircle2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { authService } from "@/services/authService";
import { courseService } from "@/services/courseService";
import { useAuth } from "@/contexts/auth-context";
import { postSignupPath } from "@/lib/routes";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Proof of a verified email, issued by the backend after a correct OTP. Kept for the tab's
// lifetime so a reload resumes at the details step; it expires server-side after 30 minutes.
const VERIFICATION_KEY = "eca_email_verification";

function readVerificationToken(): string | null {
  try {
    return sessionStorage.getItem(VERIFICATION_KEY);
  } catch {
    return null;
  }
}

function storeVerificationToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(VERIFICATION_KEY, token);
    else sessionStorage.removeItem(VERIFICATION_KEY);
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — verification simply won't survive a reload.
  }
}

/** How long the "verified" screen stays up before the redirect takes over. */
const SUCCESS_SCREEN_MS = 2000;

/**
 * Whether the freshly signed-in account already holds a package. /courses reports this for the
 * bearer token we just stored; if the call fails we assume it doesn't, which sends them to the
 * packages — the right place for anyone who still has something to buy.
 */
async function ownsAnyCourse(): Promise<boolean> {
  try {
    const { ownedCourseIds } = await courseService.list();
    return ownedCourseIds.length > 0;
  } catch {
    return false;
  }
}

export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [checkingVerified, setCheckingVerified] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [justVerified, setJustVerified] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const [form, setForm] = useState(() => ({
    name: "",
    phone: "",
    username: "",
    password: "",
    referralCode: getCookie("eca_ref") ?? "",
  }));
  const preferredLanguageCode = getCookie("eca_lang");

  useEffect(() => {
    const stored = readVerificationToken();
    Promise.resolve(stored ? authService.verifiedStatus(stored) : { email: null })
      .then(({ email: verified }) => {
        if (verified && stored) {
          setEmail(verified);
          setVerificationToken(stored);
          setEmailVerified(true);
        } else {
          storeVerificationToken(null);
        }
      })
      .catch(() => storeVerificationToken(null))
      .finally(() => setCheckingVerified(false));
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function requestOtp(isResend: boolean) {
    setError(null);
    if (isResend) setResending(true);
    else setBusy(true);
    try {
      const data = await authService.sendOtp(email, "REGISTER");
      setOtpSent(true);
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

  function sendOtp(e: FormEvent) {
    e.preventDefault();
    requestOtp(false);
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { verificationToken: token } = await authService.verifyOtp(email, code, "REGISTER");
      storeVerificationToken(token);
      setVerificationToken(token);
      setJustVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code");
    } finally {
      setBusy(false);
    }
  }

  async function completeRegistration(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!verificationToken) throw new Error("Please verify your email before creating an account.");
      // Registration signs the user straight in by returning a session token.
      const { token, user } = await authService.register({
        email,
        ...form,
        referralCode: form.referralCode || undefined,
        preferredLanguageCode: preferredLanguageCode || undefined,
        verificationToken,
      });
      storeVerificationToken(null);
      setSession(token, user);
      // The redirect is handled by the success screen below, which needs a moment on screen.
      setSignedUp(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  // Hold the success screen for SUCCESS_SCREEN_MS, resolving the destination meanwhile so the
  // ownership lookup never makes the wait any longer than the two seconds the screen promises.
  useEffect(() => {
    if (!signedUp) return;
    let cancelled = false;
    const wait = new Promise((resolve) => setTimeout(resolve, SUCCESS_SCREEN_MS));
    Promise.all([ownsAnyCourse(), wait]).then(([owns]) => {
      if (cancelled) return;
      router.replace(postSignupPath(owns));
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [signedUp, router]);

  // Signup is done and the session is live — the effect above navigates once this has been seen.
  if (signedUp) {
    return (
      <div className="card p-8 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald" />
        <h1 className="font-display text-2xl font-semibold text-parchment">Email Verified Successfully ✅</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Welcome aboard, <span className="text-parchment">{form.name || email}</span>. Taking you to your next step…
        </p>
        <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-gold-500" />
      </div>
    );
  }

  if (checkingVerified) {
    return (
      <div className="card flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  if (justVerified) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald" />
        <h1 className="font-display text-2xl font-semibold text-parchment">Email verified</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          <span className="text-parchment">{email}</span> is confirmed. Let&apos;s finish setting up your account.
        </p>
        <button
          onClick={() => {
            setJustVerified(false);
            setEmailVerified(true);
          }}
          className="btn-gold mt-6 w-full"
        >
          Continue
        </button>
      </div>
    );
  }

  if (!emailVerified) {
    return (
      <div className="card p-8">
        <div className="mb-6 text-center">
          <Mail className="mx-auto mb-3 h-8 w-8 text-gold-500" />
          <h1 className="font-display text-2xl font-semibold text-parchment">Verify your email</h1>
          <p className="mt-1 text-sm text-parchment-muted">We&apos;ll send a 6-digit code to confirm it&apos;s you.</p>
        </div>

        {!otpSent ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label className="label-field">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="btn-gold w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Verification Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-parchment-muted">
              Code sent to <span className="text-parchment">{email}</span>
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input-field tracking-[0.4em]"
              placeholder="123456"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="btn-gold w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Continue"}
            </button>
            <button
              type="button"
              onClick={() => requestOtp(true)}
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
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-gold-500 hover:text-gold-400">
            Login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="card p-8">
      <div className="mb-6 text-center">
        <UserPlus className="mx-auto mb-3 h-8 w-8 text-gold-500" />
        <h1 className="font-display text-2xl font-semibold text-parchment">Create your account</h1>
        <p className="mt-1 text-sm text-parchment-muted">Email verified — just a few more details.</p>
      </div>
      <form onSubmit={completeRegistration} className="space-y-4">
        <div>
          <label className="label-field">Full Name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field">Mobile Number</label>
            <input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="label-field">Username</label>
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="input-field"
            />
          </div>
        </div>
        <div>
          <label className="label-field">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="input-field"
          />
        </div>
        <div>
          <label className="label-field">Referral Code (optional)</label>
          <input
            value={form.referralCode}
            onChange={(e) => setForm({ ...form, referralCode: e.target.value })}
            className="input-field uppercase"
            placeholder="e.g. A1B2C3D4"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="btn-gold w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Account"}
        </button>
      </form>
    </div>
  );
}

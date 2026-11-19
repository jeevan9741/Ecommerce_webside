"use client";

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { useAuth } from "@/contexts/auth-context";
import { postLoginPath } from "@/lib/routes";
import { offerAdminLogin, saveAdminLoginIdentifier } from "@/lib/admin-login-handoff";

function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminLogin, setAdminLogin] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAdminLogin(false);
    setBusy(true);
    const res = await login(identifier, password);
    setBusy(false);
    if (!res.ok) {
      // Admin accounts finish signing in (with their authenticator) on the admin login page.
      setError(res.mfaRequired ? "This account uses two-step verification. Please sign in on the admin login page." : res.error);
      setAdminLogin(offerAdminLogin(res));
      return;
    }
    router.push(postLoginPath(res.user.role, callbackUrl));
    router.refresh();
  }

  return (
    <div className="card p-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-semibold text-parchment">Welcome back</h1>
        <p className="mt-1 text-sm text-parchment-muted">Login to access your courses and dashboard.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label-field">Email or Username</label>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="input-field"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label-field">Password</label>
            <Link href="/forgot-password" className="text-xs font-medium text-gold-500 hover:text-gold-400">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="input-field"
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {adminLogin && (
          <button
            type="button"
            className="btn-outline w-full"
            onClick={() => {
              // Only the email/username goes along (this tab's storage, never the URL); the password stays here.
              saveAdminLoginIdentifier(typeof window === "undefined" ? null : window.sessionStorage, identifier);
              router.push("/admin/login");
            }}
          >
            <ShieldCheck className="h-4 w-4" /> Go to admin login
          </button>
        )}
        <button type="submit" disabled={busy} className="btn-gold w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Login
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-parchment-muted">
        New here?{" "}
        <Link href="/register" className="font-medium text-gold-500 hover:text-gold-400">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

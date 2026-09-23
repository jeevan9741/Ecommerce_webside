"use client";

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { postLoginPath } from "@/lib/routes";

function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await login(identifier, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
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
          <label className="label-field">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="input-field"
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
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

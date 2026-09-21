"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useAuth } from "@/contexts/auth-context";

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAuth();
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
    if (res.user.role !== "ADMIN") {
      setError("This account does not have admin access.");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-5 py-12">
      <LogoMark className="mb-8" />
      <div className="w-full max-w-md card p-8">
        <div className="mb-6 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-gold-500" />
          <h1 className="font-display text-2xl font-semibold text-parchment">Admin Login</h1>
          <p className="mt-1 text-sm text-parchment-muted">Restricted access — authorized personnel only.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label-field">Admin Email or Username</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              className="input-field"
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
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={busy} className="btn-gold w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

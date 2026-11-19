"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { backendFetch } from "@/lib/api";
import { adminNotifyStatusText, testNotificationResult, type AdminNotifyStatus } from "@/lib/admin-notify";

/** Site Settings: whether admin notification emails are on (ADMIN_NOTIFY_EMAIL), and a test send. */
export function AdminNotificationsCard() {
  const [status, setStatus] = useState<AdminNotifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    backendFetch("/api/admin/notifications/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStatus(s))
      .catch(() => setStatus(null));
  }, []);

  async function sendTest() {
    setBusy(true);
    setResult(null);
    try {
      const r = await backendFetch("/api/admin/notifications/test", { method: "POST" });
      setResult(testNotificationResult(r.status, await r.json().catch(() => ({}))));
    } catch {
      setResult({ ok: false, text: "The test email couldn't be sent." });
    }
    setBusy(false);
  }

  return (
    <div className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">Admin notification emails</h2>
      <p className="mt-1 text-sm text-parchment-muted">
        New franchise applications, course payments, refunds, withdrawal requests, referral claims, partner ID card requests and job
        applications. The address is set on the server (ADMIN_NOTIFY_EMAIL).
      </p>
      <p className="mt-3 text-sm text-parchment">{adminNotifyStatusText(status)}</p>
      <button onClick={sendTest} disabled={busy || !status?.enabled} className="btn-outline mt-4 !px-4 !py-2 text-sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send test notification
      </button>
      {result && (
        <p role="status" className={`mt-3 text-sm ${result.ok ? "text-emerald-500" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

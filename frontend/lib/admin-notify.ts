/** Admin notification emails: what the Site Settings card says. Import-free so the Node test runner can load it. */

export interface AdminNotifyStatus {
  enabled: boolean;
  recipients: string[];
}

export function adminNotifyStatusText(s: AdminNotifyStatus | null): string {
  if (!s) return "Couldn't load the notification settings.";
  if (!s.enabled) return "Off — ADMIN_NOTIFY_EMAIL isn't set on the server, so no admin emails are sent.";
  return `On — sent to ${s.recipients.join(", ")}.`;
}

/** The message after pressing "Send test notification", from the API's status code and body. */
export function testNotificationResult(status: number, body: { sent?: number; recipients?: string[]; error?: string; code?: string }): { ok: boolean; text: string } {
  if (status === 200 && body.sent) return { ok: true, text: `Test email sent to ${(body.recipients ?? []).join(", ")}. Check the inbox (and spam folder).` };
  if (body.code === "ADMIN_NOTIFY_NOT_CONFIGURED") return { ok: false, text: "Admin notifications are off: set ADMIN_NOTIFY_EMAIL on the server first." };
  if (status === 429) return { ok: false, text: "Too many test emails. Try again later." };
  return { ok: false, text: body.error ?? "The test email couldn't be sent." };
}

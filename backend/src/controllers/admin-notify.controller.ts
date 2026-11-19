import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { currentUser } from "../middleware/auth.middleware.js";
import { HttpError } from "../utils/http.js";
import { rateLimit } from "../utils/rate-limit.js";
import { requireAdminRead } from "../services/franchise-admin-guard.js";
import { adminNotifyRecipients, maskAddress } from "../utils/admin-notify-config.js";
import { sendAdminNotification } from "../services/admin-notify.service.js";

/** Whether admin notifications are on, and to which (masked) addresses. */
export async function adminNotifyStatus(req: Request, res: Response) {
  await requireAdminRead(currentUser(req).id);
  const recipients = adminNotifyRecipients();
  res.json({ enabled: recipients.length > 0, recipients: recipients.map(maskAddress) });
}

/** Sends one test notification to every configured address. Admin-only, rate-limited, audited. */
export async function sendTestAdminNotification(req: Request, res: Response) {
  const admin = currentUser(req);
  await requireAdminRead(admin.id);
  if (!rateLimit(`admin-notify-test:${admin.id}`, 5, 60 * 60 * 1000)) throw new HttpError(429, "Too many test emails. Try again later.");
  if (!adminNotifyRecipients().length) {
    throw new HttpError(409, "Admin notifications are off: ADMIN_NOTIFY_EMAIL isn't set on the server.", { code: "ADMIN_NOTIFY_NOT_CONFIGURED" });
  }
  const result = await sendAdminNotification({ kind: "TEST", adminName: admin.name });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "ADMIN_NOTIFICATION_TEST_SENT", target: admin.id, metadata: result } });
  if (!result.sent) throw new HttpError(502, "The test email couldn't be sent. Check the email settings in the server logs.", { code: "ADMIN_NOTIFY_SEND_FAILED" });
  res.json({ ok: true, sent: result.sent, recipients: adminNotifyRecipients().map(maskAddress) });
}

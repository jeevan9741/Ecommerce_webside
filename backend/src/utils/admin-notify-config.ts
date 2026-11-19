/**
 * Where admin notification emails go: ADMIN_NOTIFY_EMAIL, one address or a comma-separated list.
 * Unset, empty or with no valid address means admin notifications are off. Import-free on purpose so
 * the email module's startup report can use it without a circular import.
 */
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const MAX_RECIPIENTS = 5;

export function adminNotifyRecipients(value: string | undefined = process.env.ADMIN_NOTIFY_EMAIL): string[] {
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const address = part.trim().toLowerCase();
    if (EMAIL.test(address)) seen.add(address);
  }
  return [...seen].slice(0, MAX_RECIPIENTS);
}

/** "ec***@gmail.com" — enough to recognise the address in logs and the admin page, not to harvest it. */
export const maskAddress = (address: string) => address.replace(/^([^@]{1,2})[^@]*@/, "$1***@");

/** One line for the startup log. */
export function adminNotifyStatusLine(value: string | undefined = process.env.ADMIN_NOTIFY_EMAIL): string {
  const recipients = adminNotifyRecipients(value);
  if (!recipients.length) return `[EMAIL] admin notifications: off${(value ?? "").trim() ? " (ADMIN_NOTIFY_EMAIL has no valid address)" : ""}`;
  return `[EMAIL] admin notifications: on → ${recipients.map(maskAddress).join(", ")}`;
}

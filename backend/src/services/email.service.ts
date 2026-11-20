import { adminNotifyStatusLine } from "../utils/admin-notify-config.js";

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

class EmailConfigError extends Error {}

function maskEmail(value: string | undefined) {
  if (!value) return "(not set)";
  return value.replace(/([^<\s@]{1,2})[^<\s@]*@/g, "$1***@");
}

/**
 * Startup report of the email settings with secrets masked (only whether the API key is set).
 * Providers: "resend" (production) and "console" (local development: emails are printed, not sent).
 */
export async function checkEmailOnStartup() {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  const lines = [`[EMAIL] provider=${provider}`];
  if (provider === "resend") {
    lines.push(`[EMAIL] RESEND_API_KEY=${process.env.RESEND_API_KEY ? "set" : "(not set)"} EMAIL_FROM=${maskEmail(process.env.EMAIL_FROM)}`);
  } else if (process.env.NODE_ENV !== "production") {
    lines.push("[EMAIL] Development mode: emails (including OTP codes) are printed to this console, not sent.");
  }
  lines.push(adminNotifyStatusLine());
  for (const line of lines) console.log(line);
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER ?? "console";

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey) throw new EmailConfigError("RESEND_API_KEY is not configured.");
    if (!from) throw new EmailConfigError("EMAIL_FROM is not configured.");
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new EmailConfigError(`Resend rejected the email (${error.name}): ${error.message}`);
    return;
  }

  // Never allow OTP/verification emails to be silently logged instead of delivered in production —
  // that previously meant real verification codes were printed straight into Vercel's runtime logs.
  if (process.env.NODE_ENV === "production") {
    throw new EmailConfigError(
      `EMAIL_PROVIDER is not set to a real provider ("${provider}"). Set EMAIL_PROVIDER=resend plus RESEND_API_KEY and EMAIL_FROM in production.`
    );
  }

  // Local development only: log to server console so the flow is testable without a live email account.
  console.log(`\n===== [DEV EMAIL] to=${to} subject="${subject}" =====\n${html}\n=====\n`);
}

/** Absolute URL — email clients can't resolve relative paths. PNG, since some clients don't render WebP. */
const EMAIL_LOGO_URL =
  process.env.EMAIL_LOGO_URL ?? "https://www.ecommercetrainingacademyeta.com/brand/eta-logo-email.png";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function purchaseConfirmationTemplate(p: {
  name: string;
  courseTitle: string;
  amount: string;
  invoiceNumber: string;
  paymentId: string;
  paidAt: string;
  courseUrl: string;
  invoiceUrl: string;
}): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 6px 0; color: #475569; font-size: 14px;">${label}</td><td style="padding: 6px 0; text-align: right; font-size: 14px; color: #0f172a;">${escapeHtml(value)}</td></tr>`;
  const button = (href: string, label: string, solid: boolean) =>
    `<a href="${href}" style="display: inline-block; margin: 4px; padding: 12px 22px; border-radius: 999px; font-size: 14px; font-weight: bold; text-decoration: none; ${
      solid ? "background: #2563eb; color: #ffffff;" : "border: 1px solid #2563eb; color: #2563eb;"
    }">${label}</a>`;
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px;">
      <img src="${EMAIL_LOGO_URL}" alt="E-Commerce Training Academy" width="80" height="80" style="display: block; width: 80px; height: 80px; margin: 0 auto 12px; border: 0;" />
      <h1 style="color: #2563eb; font-size: 20px; margin: 0 0 4px; text-align: center;">Payment successful</h1>
      <p style="font-size: 14px; color: #475569; margin: 0 0 20px; text-align: center;">E-Commerce Training Academy</p>
      <p style="font-size: 15px; line-height: 1.6;">Hello ${escapeHtml(p.name)},</p>
      <p style="font-size: 15px; line-height: 1.6;">Thank you for your purchase. Your course is unlocked and ready in your student portal.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
        ${row("Course", p.courseTitle)}
        ${row("Amount paid", p.amount)}
        ${row("Invoice no.", p.invoiceNumber)}
        ${row("Payment ID", p.paymentId)}
        ${row("Date", p.paidAt)}
      </table>
      <p style="text-align: center; margin: 24px 0 8px;">${button(p.courseUrl, "Start learning", true)}${button(p.invoiceUrl, "View invoice", false)}</p>
      <p style="font-size: 13px; color: #475569; line-height: 1.6; margin-top: 20px;">Questions about this payment? Just reply to this email.</p>
      <p style="font-size: 14px; line-height: 1.6; margin-top: 16px;">Regards,<br />E-Commerce Training Academy</p>
    </div>
  `;
}

export function passwordResetEmailTemplate(code: string): string {
  return `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px;">
      <img src="${EMAIL_LOGO_URL}" alt="E-Commerce Training Academy" width="80" height="80" style="display: block; width: 80px; height: 80px; margin: 0 auto 12px; border: 0;" />
      <h1 style="color: #2563eb; font-size: 20px; margin-bottom: 8px; text-align: center;">E-Commerce Training Academy</h1>
      <p style="font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="font-size: 15px; line-height: 1.6;">Use this code to reset your password:</p>
      <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #2563eb; margin: 16px 0;">${code}</p>
      <p style="font-size: 14px; line-height: 1.6;">This code will expire in 10 minutes.</p>
      <p style="font-size: 13px; color: #475569;">If you didn't ask to reset your password, you can ignore this email — your password won't change.</p>
      <p style="font-size: 14px; line-height: 1.6; margin-top: 16px;">Regards,<br />E-Commerce Training Academy</p>
    </div>
  `;
}

export function otpEmailTemplate(code: string): string {
  return `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px;">
      <img src="${EMAIL_LOGO_URL}" alt="E-Commerce Training Academy" width="80" height="80" style="display: block; width: 80px; height: 80px; margin: 0 auto 12px; border: 0;" />
      <h1 style="color: #2563eb; font-size: 20px; margin-bottom: 8px; text-align: center;">E-Commerce Training Academy</h1>
      <p style="font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="font-size: 15px; line-height: 1.6;">Your verification code is:</p>
      <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #2563eb; margin: 16px 0;">${code}</p>
      <p style="font-size: 14px; line-height: 1.6;">This code will expire in 10 minutes.</p>
      <p style="font-size: 13px; color: #475569;">If you did not create an account, please ignore this email.</p>
      <p style="font-size: 14px; line-height: 1.6; margin-top: 16px;">Regards,<br />E-Commerce Training Academy</p>
    </div>
  `;
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

class EmailConfigError extends Error {}

/**
 * The SMTP host's IPv4 address. Nodemailer picks randomly among a host's IPv4 *and* IPv6
 * addresses, and hosts without IPv6 routing (Render) then fail with ENETUNREACH on the IPv6 ones
 * (e.g. smtp.gmail.com). Falls back to the hostname if there's no IPv4 record.
 */
async function smtpIPv4(host: string) {
  const { isIP } = await import("node:net");
  if (isIP(host)) return host;
  // The OS resolver (like everything else in the app), asked for IPv4 only.
  const { lookup } = await import("node:dns/promises");
  const result = await lookup(host, { family: 4 }).catch(() => null);
  return result?.address ?? host;
}

function isGmail(host: string | undefined) {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(host ?? "");
}

/**
 * SMTP password as Gmail expects it. Google shows App Passwords in four groups ("abcd efgh ijkl
 * mnop"); the spaces aren't part of the password, so they're dropped for Gmail hosts.
 */
function smtpPassword() {
  const raw = process.env.SMTP_PASSWORD ?? "";
  return isGmail(process.env.SMTP_HOST) ? raw.replace(/\s+/g, "") : raw;
}

async function createSmtpTransport() {
  const { SMTP_HOST, SMTP_USER, EMAIL_FROM } = process.env;
  const password = smtpPassword();
  if (!SMTP_HOST || !SMTP_USER || !password || !EMAIL_FROM) {
    throw new EmailConfigError("SMTP_HOST, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM must all be configured.");
  }
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: await smtpIPv4(SMTP_HOST),
    port,
    // 465 is implicit TLS; 587/25 upgrade via STARTTLS.
    secure: port === 465,
    auth: { user: SMTP_USER, pass: password },
    // We may connect by IP (above), so verify the certificate against the real hostname.
    tls: { servername: SMTP_HOST },
    // Fail in seconds rather than holding the signup request open for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function maskEmail(value: string | undefined) {
  if (!value) return "(not set)";
  return value.replace(/([^<\s@]{1,2})[^<\s@]*@/g, "$1***@");
}

/**
 * Startup report of the email settings with secrets masked (the password is never printed — only
 * whether it's set and whether it looks like a Gmail App Password), plus, for SMTP, a live login
 * check so a wrong host/user/password shows up in the logs immediately instead of at the first OTP.
 */
export async function checkEmailOnStartup() {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  const lines = [`[EMAIL] provider=${provider}`];
  if (provider === "smtp") {
    const password = smtpPassword();
    const appPasswordShape = /^[a-z]{16}$/i.test(password);
    lines.push(
      `[EMAIL] SMTP_HOST=${process.env.SMTP_HOST || "(not set)"} SMTP_PORT=${process.env.SMTP_PORT ?? "587 (default)"}`,
      `[EMAIL] SMTP_USER=${maskEmail(process.env.SMTP_USER)} EMAIL_FROM=${maskEmail(process.env.EMAIL_FROM)}`,
      `[EMAIL] SMTP_PASSWORD=${password ? `set (${password.length} chars${isGmail(process.env.SMTP_HOST) ? appPasswordShape ? ", Gmail App Password format" : ", NOT the 16-letter Gmail App Password format" : ""})` : "(not set)"}`
    );
  } else if (provider === "resend") {
    lines.push(`[EMAIL] RESEND_API_KEY=${process.env.RESEND_API_KEY ? "set" : "(not set)"} EMAIL_FROM=${maskEmail(process.env.EMAIL_FROM)}`);
  } else if (process.env.NODE_ENV !== "production") {
    lines.push("[EMAIL] Development mode: emails (including OTP codes) are printed to this console, not sent.");
  }
  for (const line of lines) console.log(line);

  if (provider !== "smtp") return;
  try {
    const transport = await createSmtpTransport();
    await transport.verify();
    console.log("[EMAIL] SMTP login OK — OTP emails can be sent.");
  } catch (err) {
    console.error(`[EMAIL] SMTP check FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
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

  if (provider === "smtp") {
    const transport = await createSmtpTransport();
    await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
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

export function otpEmailTemplate(code: string): string {
  return `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h1 style="color: #2563eb; font-size: 20px; margin-bottom: 8px;">E-Commerce Training Academy</h1>
      <p style="font-size: 15px; line-height: 1.6;">Hello,</p>
      <p style="font-size: 15px; line-height: 1.6;">Your verification code is:</p>
      <p style="font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #2563eb; margin: 16px 0;">${code}</p>
      <p style="font-size: 14px; line-height: 1.6;">This code will expire in 10 minutes.</p>
      <p style="font-size: 13px; color: #475569;">If you did not create an account, please ignore this email.</p>
      <p style="font-size: 14px; line-height: 1.6; margin-top: 16px;">Regards,<br />E-Commerce Training Academy</p>
    </div>
  `;
}

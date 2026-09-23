interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

class EmailConfigError extends Error {}

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
    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !EMAIL_FROM) {
      throw new EmailConfigError("SMTP_HOST, SMTP_USER, SMTP_PASSWORD and EMAIL_FROM must all be configured.");
    }
    const nodemailer = await import("nodemailer");
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      // 465 is implicit TLS; 587/25 upgrade via STARTTLS.
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
    await transport.sendMail({ from: EMAIL_FROM, to, subject, html });
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

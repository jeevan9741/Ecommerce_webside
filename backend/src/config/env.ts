import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

/** Used only when CORS_ORIGINS is unset — production must never fall back to localhost. */
const DEFAULT_CORS_ORIGIN = isProduction
  ? "https://ecommerce-training-academy-jeevan-f45f.vercel.app"
  : "http://localhost:3000";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: Number(process.env.PORT ?? 5000),

  databaseUrl: required("DATABASE_URL"),

  /** Signs the API's own session tokens. */
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  /** Signs the short-lived "this email is verified" token used between OTP and registration. */
  emailVerificationSecret: process.env.EMAIL_VERIFICATION_SECRET ?? required("JWT_SECRET"),

  /** Encrypts payout details at rest (AES-256-GCM, 64 hex chars). */
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",

  corsOrigins: (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGIN)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  },

  email: {
    provider: process.env.EMAIL_PROVIDER ?? "console",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "",
    smtpHost: process.env.SMTP_HOST ?? "",
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER ?? "",
    smtpPassword: process.env.SMTP_PASSWORD ?? "",
  },

  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? "",
} as const;

/**
 * Names (never values) of production settings that are missing or unusable. The server still
 * starts — each feature fails with a clear error on use — but this makes the gap visible in the
 * Render logs at boot instead of on a customer's first checkout.
 */
export function productionConfigProblems(): string[] {
  if (!isProduction) return [];
  const problems: string[] = [];
  const need = (name: string) => {
    if (!process.env[name]) problems.push(`${name} is not set`);
  };
  need("CORS_ORIGINS");
  need("EMAIL_VERIFICATION_SECRET");
  need("RAZORPAY_KEY_ID");
  need("RAZORPAY_KEY_SECRET");
  need("RAZORPAY_WEBHOOK_SECRET");
  if ((process.env.APP_ENCRYPTION_KEY ?? "").length !== 64) {
    problems.push("APP_ENCRYPTION_KEY must be a 64-character hex string (payout details can't be saved)");
  }
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  if (provider === "resend") {
    need("RESEND_API_KEY");
    need("EMAIL_FROM");
  } else if (provider !== "smtp") {
    problems.push(`EMAIL_PROVIDER is "${provider}" — set it to "resend" or verification emails will fail`);
  }
  if (env.corsOrigins.some((o) => o.includes("localhost"))) {
    problems.push("CORS_ORIGINS includes a localhost origin");
  }
  return problems;
}

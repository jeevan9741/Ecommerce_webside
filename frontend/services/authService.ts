import { api } from "@/lib/api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  referralCode: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  username: string;
  password: string;
  referralCode?: string;
  preferredLanguageCode?: string;
  /** Proof of a verified email, issued by verifyOtp. */
  verificationToken: string;
}

type OtpPurpose = "REGISTER";

/** An admin with two-step verification gets a short challenge instead of a session. */
export type LoginResponse =
  | { token: string; user: SessionUser; mfaEnrollmentRequired?: boolean }
  | { mfaRequired: true; challengeToken: string };

export const authService = {
  login: (identifier: string, password: string) => api.post<LoginResponse>("/auth/login", { identifier, password }),

  /** The sign-in second step: an authenticator code or a one-time recovery code. */
  verifyMfa: (challengeToken: string, answer: { code: string } | { recoveryCode: string }) =>
    api.post<{ token: string; user: SessionUser; method: "TOTP" | "RECOVERY_CODE"; recoveryCodesRemaining: number }>("/auth/mfa/verify", { challengeToken, ...answer }),

  session: () => api.get<{ user: SessionUser }>("/auth/session"),

  register: (input: RegisterInput) =>
    api.post<{ ok: true; token: string; user: SessionUser }>("/register", input),

  sendOtp: (email: string, purpose: OtpPurpose = "REGISTER") =>
    api.post<{ ok: true; retryAfterSeconds: number }>("/email/send-otp", { email, purpose }),

  verifyOtp: (email: string, code: string, purpose: OtpPurpose = "REGISTER") =>
    api.post<{ ok: true; verificationToken: string }>("/email/verify-otp", { email, code, purpose }),

  /** Emails a password reset code. Replies the same whether or not the email has an account. */
  forgotPassword: (email: string) =>
    api.post<{ ok: true; retryAfterSeconds: number }>("/auth/forgot-password", { email }),

  /** Sets a new password with the emailed code and signs the user in. */
  resetPassword: (email: string, code: string, password: string) =>
    api.post<{ ok: true; token: string; user: SessionUser }>("/auth/reset-password", { email, code, password }),

  /** Returns the verified email if a previously issued verification token is still valid. */
  verifiedStatus: (token: string) =>
    api.get<{ email: string | null }>(`/email/verified-status?token=${encodeURIComponent(token)}`),
};

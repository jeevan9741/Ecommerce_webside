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

type OtpPurpose = "REGISTER" | "LOGIN_RESET";

export const authService = {
  login: (identifier: string, password: string) =>
    api.post<{ token: string; user: SessionUser }>("/auth/login", { identifier, password }),

  session: () => api.get<{ user: SessionUser }>("/auth/session"),

  register: (input: RegisterInput) =>
    api.post<{ ok: true; token: string; user: SessionUser }>("/register", input),

  sendOtp: (email: string, purpose: OtpPurpose = "REGISTER") =>
    api.post<{ ok: true; retryAfterSeconds: number }>("/email/send-otp", { email, purpose }),

  verifyOtp: (email: string, code: string, purpose: OtpPurpose = "REGISTER") =>
    api.post<{ ok: true; verificationToken: string }>("/email/verify-otp", { email, code, purpose }),

  /** Returns the verified email if a previously issued verification token is still valid. */
  verifiedStatus: (token: string) =>
    api.get<{ email: string | null }>(`/email/verified-status?token=${encodeURIComponent(token)}`),
};

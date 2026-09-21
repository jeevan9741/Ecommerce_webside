import { api } from "@/lib/api";

export interface ProfileUpdate {
  name?: string;
  phone?: string;
  preferredLanguageCode?: string | null;
}

export const userService = {
  getMe: () => api.get<{ user: Record<string, unknown> }>("/me"),
  updateMe: (data: ProfileUpdate) => api.patch<{ user: Record<string, unknown> }>("/me", data),
  orders: () => api.get<{ orders: unknown[] }>("/me/orders"),
};

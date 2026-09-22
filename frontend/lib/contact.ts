import { api } from "@/lib/api";

export const DEFAULT_CONTACT = {
  address: "Rayadurgam, Andhra Pradesh, India",
  email: "support@ecommerceacademy.in",
  phone: "+91 00000 00000",
  whatsapp: "https://wa.me/910000000000",
  telegram: "https://t.me/ecommercetrainingacademy",
};

export type Contact = typeof DEFAULT_CONTACT;

/** Admin-configured contact details, falling back to defaults so a backend hiccup never breaks the page. */
export async function getContact(): Promise<Contact> {
  const settings = await api
    .get<{ settings: Record<string, unknown> }>("/settings/public", { token: null })
    .then((r) => r.settings)
    .catch(() => ({}) as Record<string, unknown>);
  return { ...DEFAULT_CONTACT, ...((settings.contact as object) ?? {}) };
}

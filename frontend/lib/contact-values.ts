/**
 * Which contact details may be shown publicly. Only values an admin actually saved count — never the
 * built-in defaults — and placeholders (an all-zero phone or WhatsApp number, a malformed email or
 * link) are dropped, so the site never shows a contact link that goes nowhere. Import-free so the
 * Node test runner can load it.
 */

export interface ShownContact {
  address?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  telegram?: string;
}

/** An all-zero phone number or WhatsApp link (optionally with the +91 country code), or nothing at all. */
export function isPlaceholderContact(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (v === "") return true;
  if (!/^(?:https?:\/\/(?:wa\.me|api\.whatsapp\.com)|\+?[\d\s()-]+$)/i.test(v)) return false; // not a phone or WhatsApp link
  const digits = v.replace(/\D/g, "");
  const national = digits.startsWith("91") && digits.length > 10 ? digits.slice(2) : digits;
  return national.length > 0 && /^0+$/.test(national);
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isHttpsUrl = (v: string, hosts: RegExp) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && hosts.test(u.hostname);
  } catch {
    return false;
  }
};

/** The admin-saved contact settings, reduced to the values that are real enough to show. */
export function shownContact(saved: unknown): ShownContact {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const out: ShownContact = {};
  const address = text(s.address);
  if (address.length >= 3) out.address = address;
  const email = text(s.email);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email;
  const phone = text(s.phone);
  if (/^\+?[\d\s()-]{7,20}$/.test(phone) && phone.replace(/\D/g, "").length >= 7 && !isPlaceholderContact(phone)) out.phone = phone;
  const whatsapp = text(s.whatsapp);
  if (isHttpsUrl(whatsapp, /^(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)$/i) && !isPlaceholderContact(whatsapp)) out.whatsapp = whatsapp;
  const telegram = text(s.telegram);
  if (isHttpsUrl(telegram, /^(?:t\.me|telegram\.me)$/i) && new URL(telegram).pathname.replace(/\//g, "") !== "") out.telegram = telegram;
  return out;
}

/** `tel:` link for a shown phone number. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

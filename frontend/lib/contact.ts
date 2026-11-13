import { api } from "@/lib/api";
import { shownContact, type ShownContact } from "@/lib/contact-values";

/** Admin edits show up within this many seconds; in between, pages using the footer are served from cache. */
const CONTACT_REVALIDATE_SECONDS = 300;
/** A slow or sleeping backend means no contact details are shown, instead of holding the page. */
const CONTACT_TIMEOUT_MS = 3000;

function publicSettings() {
  return api
    .get<{ settings: Record<string, unknown> }>("/settings/public", {
      token: null,
      cache: "force-cache",
      next: { revalidate: CONTACT_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(CONTACT_TIMEOUT_MS),
    })
    .then((r) => r.settings)
    .catch(() => ({}) as Record<string, unknown>);
}

/**
 * Only the contact details an admin actually saved and that are real (see shownContact) — for public
 * pages, which must never show the built-in defaults or a placeholder as a working link.
 */
export async function getShownContact(): Promise<ShownContact> {
  return shownContact((await publicSettings()).contact);
}

/**
 * What an e-book card offers. The server decides `locked` from the student's PAID orders (and
 * refuses locked downloads itself); this only turns that into the button. A card is downloadable
 * only when the server explicitly says it is unlocked — anything missing or unexpected is locked.
 * Import-free so the Node test runner can load it.
 */

export type EBookCardAction =
  | { kind: "download" }
  | { kind: "buy"; languageCode: string; languageName: string; packageId: string }
  | { kind: "not-included"; languageName: string };

export function ebookCardAction(
  ebook: { locked?: boolean; language: { code: string; name: string } | null; course: { id: string } },
  pkg: { id: string; type: string } | undefined
): EBookCardAction {
  if (ebook.locked === false) return { kind: "download" };
  const languageName = ebook.language?.name ?? "this";
  // E-book packages sell each language separately, so a locked language can be bought on its own.
  if (ebook.language && pkg && pkg.id === ebook.course.id && pkg.type === "EBOOK") {
    return { kind: "buy", languageCode: ebook.language.code, languageName: ebook.language.name, packageId: pkg.id };
  }
  return { kind: "not-included", languageName };
}

/** The banner an admin sees on the student e-book library (admins can open every e-book). */
export function adminLibraryNote(role: string | null | undefined) {
  return role === "ADMIN"
    ? "Admin view: every e-book is available to you. Customers see Download only for the languages their purchase includes; other languages are locked for them."
    : null;
}

/** The note shown above a package's e-books when a legacy purchase includes every language. */
export function legacyAllLanguagesNote(access: { allLanguages: boolean } | undefined) {
  return access?.allLanguages
    ? "Your purchase was made before e-books were sold per language, so it includes every language."
    : null;
}

/**
 * Message for a failed download, and whether the page must reload entitlements. A 403 means the
 * server refused it — e.g. a tab opened before a change still showing an old Download button — so
 * the library is reloaded and the card falls back to its locked state.
 */
export function downloadFailure(status: number | null, code: unknown, message: string | null) {
  if (status === 403 && code === "LANGUAGE_NOT_PURCHASED") {
    return { message: "This language isn't included in your purchase.", reload: true };
  }
  if (status === 403) return { message: "Your access to this e-book isn't active. Contact support if you think this is a mistake.", reload: true };
  if (status === 429 && message) return { message, reload: false };
  return { message: "The download couldn't start. Please try again.", reload: false };
}

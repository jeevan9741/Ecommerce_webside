/**
 * Which language a checkout starts with. E-book packages are sold per e-book language, so with
 * several languages the customer must choose (""), never a silent default; a preset (buying a
 * locked language from the library) or a single language is used as is. Other packages start on
 * their first language — it only sets the course player's starting language. The server validates
 * whatever is sent. Import-free so the Node test runner can load it.
 */
export function initialCheckoutLanguage(course: { type: string; languages: { code: string }[] }, presetCode?: string) {
  if (presetCode) return presetCode;
  if (course.type === "EBOOK" && course.languages.length > 1) return "";
  return course.languages[0]?.code ?? "";
}

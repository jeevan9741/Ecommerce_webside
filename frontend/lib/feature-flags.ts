/**
 * Dark-launch switches for the frontend. A switch is on only when its value is exactly "true" (any case,
 * surrounding spaces ignored). NEXT_PUBLIC_ values are baked in at build time, so changing one needs a
 * rebuild and redeploy. Import-free so the Node test runner can load it.
 */
export const isSwitchOn = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "true";

/** Public franchise pages and their navigation links. Admin franchise pages are never gated by it. */
// The literal `process.env.NEXT_PUBLIC_…` reference is what Next.js inlines at build time.
export const franchisePublicEnabled = (value: string | undefined = process.env.NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED) => isSwitchOn(value);

/** Franchise partner dashboard (/franchise-partner) and its navigation link. Independent of the public switch. */
export const franchisePartnerEnabled = (value: string | undefined = process.env.NEXT_PUBLIC_FRANCHISE_PARTNER_ENABLED) => isSwitchOn(value);

/** Adds a link only when its feature is switched on (used for navigation lists). */
export const withLinkIf = <T>(links: T[], link: T, enabled: boolean): T[] => (enabled ? [...links, link] : links);

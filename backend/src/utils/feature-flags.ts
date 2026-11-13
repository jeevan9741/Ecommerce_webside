/**
 * Dark-launch switches. A switch is on only when its value is exactly "true" (any case, surrounding
 * spaces ignored); unset, "false", "1", "yes" or a typo all mean off. Read on every request, so a
 * changed value takes effect on restart without a rebuild.
 */
export const isSwitchOn = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "true";

/** Public and applicant franchise API (/api/franchise/*). Admin franchise routes are never gated by it. */
export const franchisePublicEnabled = () => isSwitchOn(process.env.FRANCHISE_PUBLIC_ENABLED);

/** Franchise partner dashboard API (/api/franchise-partner/*). Independent of the public switch. */
export const franchisePartnerEnabled = () => isSwitchOn(process.env.FRANCHISE_PARTNER_ENABLED);

/**
 * Admin two-step verification is ON unless ADMIN_MFA_ENFORCEMENT is exactly "off" — and it can never be
 * turned off when NODE_ENV=production. "off" exists only so older local test suites, whose admin fixtures
 * predate MFA, keep running; the MFA suite runs with it on.
 */
export const adminMfaEnforced = () =>
  process.env.NODE_ENV === "production" || (process.env.ADMIN_MFA_ENFORCEMENT ?? "").trim().toLowerCase() !== "off";

// Server-only by construction: it reads the session cookie through lib/session.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { api, ApiError } from "./api";
import { getSession } from "./session";
import { franchisePartnerEnabled } from "./feature-flags";

export interface PartnerProfile {
  franchiseCode: string;
  status: string;
  ownerName: string;
  ownerEmail: string;
  district: string;
  districtCode: string | null;
  state: string;
  agreementStartsAt: string;
  agreementEndsAt: string;
  activatedAt: string;
  attributionAllowed: boolean;
  payoutsPaused: boolean;
  /** The state this franchise holds (one primary franchise per state), from its allocation record. */
  territory: { state: string; status: string; allocatedAt: string | null } | null;
}

/**
 * The signed-in user's own franchise, as the API decides it (database-verified on every request).
 * Anyone who isn't an active partner — and everyone while the switch is off — gets a plain 404, so the
 * dashboard's existence isn't revealed. Cached per request so the layout and page share one call.
 */
export const requirePartnerProfile = cache(async (): Promise<PartnerProfile> => {
  if (!franchisePartnerEnabled()) notFound();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/franchise-partner");
  try {
    const { partner } = await api.get<{ partner: PartnerProfile }>("/franchise-partner/me", { token: session.token });
    return partner;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 401)) notFound();
    throw err;
  }
});

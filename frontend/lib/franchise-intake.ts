import { api } from "@/lib/api";
import { franchisePublicEnabled } from "@/lib/feature-flags";
import { applicationsOpen } from "@/lib/franchise-nav";

/** How long the homepage may show a cached answer; the apply page and submit API always ask afresh. */
const INTAKE_REVALIDATE_SECONDS = 300;
/** A slow or sleeping backend means "closed" instead of holding the page. */
const INTAKE_TIMEOUT_MS = 3000;

/**
 * Server-side: whether franchise applications are genuinely open (see applicationsOpen). While the public
 * switch is off no franchise API is called at all. Any failure counts as closed.
 */
export async function getApplicationsOpen(opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (!franchisePublicEnabled()) return false;
  const info = await api
    .get<{ open?: unknown }>("/franchise/info", {
      token: null,
      signal: AbortSignal.timeout(INTAKE_TIMEOUT_MS),
      ...(opts.fresh ? {} : { cache: "force-cache", next: { revalidate: INTAKE_REVALIDATE_SECONDS } }),
    })
    .catch(() => null);
  return applicationsOpen(true, info);
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { franchisePartnerEnabled } from "@/lib/feature-flags";
import { getSession } from "@/lib/session";
import { AcceptInvite } from "@/components/franchise/accept-invite";

export const metadata = { title: "Franchise Invitation" };
export const dynamic = "force-dynamic";

interface Preview {
  status: string;
  inviteeName: string;
  expiresAt: string;
  emailMatches: boolean;
  franchise: { code: string; ownerName: string; district: string; state: string };
}

/**
 * A student opening an invitation. They must be signed in to their own ETA account (the invited email);
 * accepting links that account to the franchise. Part of the partner feature, so dark with it.
 */
export default async function FranchiseInvitePage({ params }: { params: Promise<{ token: string }> }) {
  if (!franchisePartnerEnabled()) notFound();
  const { token } = await params;
  const here = `/franchise/invite/${encodeURIComponent(token)}`;
  const session = await getSession();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(here)}`);

  let invite: Preview | null = null;
  try {
    invite = (await api.get<{ invite: Preview }>(`/franchise-invites/${encodeURIComponent(token)}`, { token: session.token })).invite;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }

  return (
    <div className="container-academy py-16">
      <div className="card mx-auto max-w-xl space-y-4 p-8">
        <p className="eyebrow">Franchise invitation</p>
        {!invite ? (
          <>
            <h1 className="font-display text-2xl font-semibold text-parchment">This invitation link isn&apos;t valid</h1>
            <p className="text-sm text-parchment-muted">It may have been replaced by a newer link. Ask the franchise to send it again.</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold text-parchment">
              {invite.franchise.ownerName} invited you to join their franchise
            </h1>
            <p className="text-sm text-parchment-muted">
              Franchise {invite.franchise.code} · {invite.franchise.district}, {invite.franchise.state}
            </p>
            {invite.status === "OPEN" && invite.emailMatches && (
              <>
                <p className="text-sm text-parchment-muted">Accepting links your ETA account to this franchise as their student. Your login, courses and purchases don&apos;t change.</p>
                <AcceptInvite token={token} />
              </>
            )}
            {invite.status === "OPEN" && !invite.emailMatches && (
              <p className="text-sm text-parchment-muted">
                This invitation was sent to a different email address. Sign out and sign in with the invited account — or create one with that email — then open this link again.
              </p>
            )}
            {invite.status === "ACCEPTED" && <p className="text-sm text-parchment-muted">This invitation has already been accepted.</p>}
            {invite.status === "EXPIRED" && <p className="text-sm text-parchment-muted">This invitation has expired. Ask the franchise to send it again.</p>}
            {invite.status === "REVOKED" && <p className="text-sm text-parchment-muted">This invitation was cancelled by the franchise.</p>}
            <Link href="/dashboard" className="inline-block text-sm text-gold-500 hover:underline">Go to my portal</Link>
          </>
        )}
      </div>
    </div>
  );
}

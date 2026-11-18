import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { franchiseDemoData } from "@/lib/feature-flags";
import { getSession } from "@/lib/session";
import type { FranchiseInfo, FranchiseState, MyFranchiseApplication } from "@/lib/franchise";
import { FranchiseApplyForm } from "@/components/franchise/apply-form";
import { FranchiseComingSoon } from "@/components/franchise/coming-soon";
import { applyPageTitle } from "@/lib/franchise-nav";
import { getApplicationsOpen } from "@/lib/franchise-intake";

export async function generateMetadata() {
  return { title: applyPageTitle(await getApplicationsOpen({ fresh: true })) };
}
export const dynamic = "force-dynamic";

export default async function FranchiseApplyPage() {
  // Until applications are genuinely open (public switch on AND the server's intake check), everyone gets a
  // "coming soon" notice: no sign-in, no form. Checked before the session so a closed programme never sends
  // visitors to the login page. Fails closed; with the switch off no franchise API is called.
  if (!(await getApplicationsOpen({ fresh: true }))) {
    return (
      <FranchiseComingSoon title="Franchise applications are coming soon">
        <p>We&apos;re preparing the ETA Franchise Partner programme. Applications aren&apos;t open yet, so there is nothing to fill in or pay today.</p>
        <p>Please check back soon.</p>
      </FranchiseComingSoon>
    );
  }
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/franchise/apply");
  const loaded = await Promise.all([
    api.get<FranchiseInfo>("/franchise/info", { token: null }),
    api.get<{ states: FranchiseState[] }>("/franchise/locations", { token: null }),
    api.get<{ application: MyFranchiseApplication | null }>("/franchise/applications/me", { token: session.token }),
  ]).catch(() => null);
  if (!loaded) {
    return (
      <div className="container-academy py-12 sm:py-16">
        <div className="card mx-auto max-w-3xl p-8" role="alert">
          <h1 className="font-display text-2xl font-semibold text-parchment">We couldn&apos;t load the application form</h1>
          <p className="mt-3 text-sm text-parchment-muted">Please try again in a moment. Nothing has been submitted.</p>
          <Link href="/franchise" className="btn-outline btn-sm mt-6 inline-flex">
            Back to the franchise page
          </Link>
        </div>
      </div>
    );
  }
  const [info, locations, mine] = loaded;
  if (mine.application && !["REJECTED", "WITHDRAWN"].includes(mine.application.status)) redirect("/franchise/application");

  return (
    <div className="container-academy py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">Franchise Application</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-parchment sm:text-4xl">Apply for a state franchise</h1>
        {info.open && info.privacyNotice && info.documentRequirements ? (
          <div className="mt-8">
            <FranchiseApplyForm
              email={session.user.email}
              defaultName={session.user.name}
              states={locations.states}
              requirements={info.documentRequirements}
              privacyNotice={info.privacyNotice}
              demoDistricts={franchiseDemoData()}
            />
          </div>
        ) : (
          <div className="card mt-8 p-8">
            <h2 className="font-display text-xl font-semibold text-parchment">Applications aren&apos;t open yet</h2>
            <p className="mt-3 text-sm text-parchment-muted">We&apos;ll open the form once the programme terms are published.</p>
            <Link href="/franchise" className="btn-outline btn-sm mt-6 inline-flex">
              Back to the franchise page
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

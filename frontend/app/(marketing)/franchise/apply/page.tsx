import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { franchisePublicEnabled } from "@/lib/feature-flags";
import { getSession } from "@/lib/session";
import type { FranchiseInfo, FranchiseState, MyFranchiseApplication } from "@/lib/franchise";
import { FranchiseApplyForm } from "@/components/franchise/apply-form";

export const metadata = { title: "Apply for a Franchise" };
export const dynamic = "force-dynamic";

export default async function FranchiseApplyPage() {
  // Dark launch: the page doesn't exist until NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED=true.
  if (!franchisePublicEnabled()) notFound();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/franchise/apply");
  const [info, locations, mine] = await Promise.all([
    api.get<FranchiseInfo>("/franchise/info", { token: null }),
    api.get<{ states: FranchiseState[] }>("/franchise/locations", { token: null }),
    api.get<{ application: MyFranchiseApplication | null }>("/franchise/applications/me", { token: session.token }),
  ]);
  if (mine.application && mine.application.status !== "REJECTED") redirect("/franchise/application");

  return (
    <div className="container-academy py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">Franchise Application</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-parchment sm:text-4xl">Apply for a district franchise</h1>
        {info.open && info.refundPolicy && info.documentRequirements ? (
          <div className="mt-8">
            <FranchiseApplyForm
              email={session.user.email}
              defaultName={session.user.name}
              states={locations.states}
              requirements={info.documentRequirements}
              refundPolicy={info.refundPolicy}
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

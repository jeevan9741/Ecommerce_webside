import Link from "next/link";
import { Building2, FileCheck, MapPin, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { FranchiseInfo } from "@/lib/franchise";
import { formatPaise } from "@/lib/policy-format";

export const metadata = { title: "Franchise Opportunity" };
export const dynamic = "force-dynamic";

/**
 * Public opportunity page. Every commercial figure comes from the published, two-admin approved
 * policy; anything not yet decided is shown as "to be announced", never guessed.
 */
export default async function FranchisePage() {
  let info: FranchiseInfo | null = null;
  try {
    info = await api.get<FranchiseInfo>("/franchise/info", { token: null });
  } catch {
    info = null;
  }
  const fee = info?.franchiseFeeInPaise ? formatPaise(info.franchiseFeeInPaise) : null;
  const years = info?.agreementTermMonths ? info.agreementTermMonths / 12 : null;

  return (
    <div className="container-academy py-16 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">Franchise Opportunity</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-parchment sm:text-5xl">
          Run the academy in <span className="gold-text">your district</span>
        </h1>
        <p className="mt-6 text-base leading-relaxed text-parchment-muted">
          We partner with one primary franchise in each district. Apply for the district you want to serve; our team reviews every
          application and contacts you about the next steps. Applying doesn&apos;t reserve a district or guarantee that it will be allocated to you.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {info?.open ? (
            <Link href="/franchise/apply" className="btn-gold btn-lg">
              Apply now
            </Link>
          ) : (
            <span className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-parchment-muted">Applications open soon</span>
          )}
          <Link href="/franchise/application" className="btn-outline btn-lg">
            Check my application
          </Link>
        </div>
      </div>

      <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={<Building2 className="h-6 w-6 text-gold-500" />} title="Franchise fee" value={fee ?? "To be announced"} note={fee ? feeGstNote(info) : null} />
        <Fact icon={<FileCheck className="h-6 w-6 text-gold-500" />} title="Agreement term" value={years ? `${years % 1 === 0 ? years : years.toFixed(1)} years` : "To be announced"} />
        <Fact icon={<MapPin className="h-6 w-6 text-gold-500" />} title="Territory" value="One primary partner per district" />
        <Fact icon={<ShieldCheck className="h-6 w-6 text-gold-500" />} title="Your documents" value="Stored privately" note="Only you and our review team can open them." />
      </div>

      <div className="mx-auto mt-16 max-w-3xl space-y-6">
        <section className="card p-8">
          <h2 className="font-display text-xl font-semibold text-parchment">How it works</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-parchment-muted">
            <li>
              <span className="font-semibold text-parchment">Application.</span> Sign in with your verified email and submit the form with your documents. Submitting the
              form doesn&apos;t take any payment.
            </li>
            <li>
              <span className="font-semibold text-parchment">Review.</span> Our team reviews your application and may invite you for a discussion.
            </li>
            <li>
              <span className="font-semibold text-parchment">Approval and district allocation.</span> Approval is a separate decision by our team. A district is allocated
              only through that approval process, never by submitting an application.
            </li>
            <li>
              <span className="font-semibold text-parchment">Agreement and fee.</span> Only after approval do you receive the franchise agreement and the fee payment
              details.
            </li>
          </ol>
        </section>
        <section className="card p-8">
          <h2 className="font-display text-xl font-semibold text-parchment">Fee refund policy</h2>
          {info?.refundPolicy ? (
            <>
              <p className="mt-1 text-xs text-parchment-muted">Version {info.refundPolicy.version}</p>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-parchment-muted">{info.refundPolicy.text}</p>
            </>
          ) : (
            <p className="mt-4 text-sm text-parchment-muted">The refund policy will be published before applications open.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function feeGstNote(info: FranchiseInfo | null) {
  return info?.franchiseFeeGst === "PENDING" ? "GST treatment to be confirmed" : null;
}

function Fact({ icon, title, value, note }: { icon: React.ReactNode; title: string; value: string; note?: string | null }) {
  return (
    <div className="card p-6">
      {icon}
      <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide text-parchment-muted">{title}</h2>
      <p className="mt-2 font-display text-lg font-semibold text-parchment">{value}</p>
      {note && <p className="mt-1 text-xs text-parchment-muted">{note}</p>}
    </div>
  );
}

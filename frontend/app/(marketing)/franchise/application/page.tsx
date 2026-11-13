import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { franchisePublicEnabled } from "@/lib/feature-flags";
import { getSession } from "@/lib/session";
import type { MyFranchiseApplication } from "@/lib/franchise";
import { DOCUMENT_KIND_LABEL, formatBytes, formatRupees, STATUS_STEPS, stepIndex } from "@/lib/franchise-form";
import { DocumentLink } from "@/components/franchise/document-link";
import { WithdrawApplication } from "@/components/franchise/withdraw-application";

export const metadata = { title: "My Franchise Application" };
export const dynamic = "force-dynamic";

const dateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function MyFranchiseApplicationPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  // Dark launch: the page doesn't exist until NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED=true.
  if (!franchisePublicEnabled()) notFound();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/franchise/application");
  const { submitted } = await searchParams;
  const { application: app } = await api.get<{ application: MyFranchiseApplication | null }>("/franchise/applications/me", { token: session.token });

  if (!app) {
    return (
      <div className="container-academy py-16">
        <div className="card mx-auto max-w-xl p-8 text-center">
          <h1 className="font-display text-2xl font-semibold text-parchment">No franchise application yet</h1>
          <p className="mt-3 text-sm text-parchment-muted">When you apply, you can follow its progress here.</p>
          <Link href="/franchise" className="btn-gold mt-6 inline-flex">See the franchise opportunity</Link>
        </div>
      </div>
    );
  }

  const current = stepIndex(app.status);
  return (
    <div className="container-academy py-12 sm:py-16">
      <div className="mx-auto max-w-3xl space-y-6">
        {submitted && (
          <div role="status" className="card flex items-center gap-3 border-emerald/40 p-4 text-sm text-parchment">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" /> Application received. We&apos;ve emailed you a confirmation. This doesn&apos;t reserve the state;
            our team will review your application.
          </div>
        )}
        <div>
          <p className="eyebrow">Franchise Application</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-parchment">{app.applicationNo}</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            {app.state} · training centre in {app.district} · submitted {dateTime(app.submittedAt)}
          </p>
        </div>

        <section className="card p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-parchment">Status: {app.statusLabel}</h2>
          {app.status === "REJECTED" ? (
            <div className="mt-4 flex gap-3 text-sm text-parchment-muted">
              <XCircle className="h-5 w-5 shrink-0 text-danger" />
              <div>
                <p>We&apos;re unable to take this application forward.</p>
                {app.rejectionReason && <p className="mt-2">{app.rejectionReason}</p>}
                <Link href="/franchise/apply" className="btn-outline btn-sm mt-4 inline-flex">Apply again</Link>
              </div>
            </div>
          ) : app.status === "WITHDRAWN" ? (
            <div className="mt-4 flex gap-3 text-sm text-parchment-muted">
              <XCircle className="h-5 w-5 shrink-0 text-parchment-muted" />
              <div>
                <p>You withdrew this application. Nothing more will happen with it.</p>
                <Link href="/franchise/apply" className="btn-outline btn-sm mt-4 inline-flex">Apply again</Link>
              </div>
            </div>
          ) : (
            <ol className="mt-4 space-y-3">
              {STATUS_STEPS.map((s, i) => (
                <li key={s.status} className="flex items-center gap-3 text-sm">
                  {i <= current ? <CheckCircle2 className="h-5 w-5 text-emerald" /> : <Circle className="h-5 w-5 text-parchment-muted/50" />}
                  <span className={i <= current ? "text-parchment" : "text-parchment-muted"}>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
          {app.canWithdraw && <WithdrawApplication />}
        </section>

        <section className="card p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-parchment">History</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {app.timeline.map((t, i) => (
              <li key={i}>
                <p className="text-parchment">{t.label}</p>
                <p className="text-xs text-parchment-muted">{dateTime(t.at)}{t.note && t.note !== t.label ? ` · ${t.note}` : ""}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-parchment">Documents</h2>
          <ul className="mt-4 divide-y divide-white/5 text-sm">
            {app.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-parchment">{DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}</p>
                  <p className="text-xs text-parchment-muted">{d.originalName} · {formatBytes(d.sizeBytes)}</p>
                </div>
                <DocumentLink documentId={d.id} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold text-parchment">Your answers</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <Item label="Name" value={app.applicantName} />
            <Item label="Mobile" value={app.mobile} />
            <Item label="Email" value={app.email} />
            <Item label="Education" value={app.education} />
            <Item label="Investment capacity" value={app.investmentCapacityInr !== null ? formatRupees(app.investmentCapacityInr) : null} />
            <Item label="Office or training space" value={app.officeAvailable === null ? null : app.officeAvailable ? "Yes" : "Not yet"} />
            <Item label="Address" value={app.address} wide />
            <Item label="Business experience" value={app.businessExperience} wide />
            <Item label="Business plan" value={app.businessPlanText} wide />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-parchment-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-parchment">{value || "—"}</dd>
    </div>
  );
}

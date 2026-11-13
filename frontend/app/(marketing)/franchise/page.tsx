import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  Handshake,
  LifeBuoy,
  Mail,
  MapPin,
  MessageCircle,
  Percent,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { getShownContact } from "@/lib/contact";
import { telHref, type ShownContact } from "@/lib/contact-values";
import { franchiseDemoData, franchisePublicEnabled } from "@/lib/feature-flags";
import { STATE_CLOSED_MESSAGE, type FranchiseInfo, type FranchiseState } from "@/lib/franchise";
import { formatShareBps } from "@/lib/franchise-form";
import { DEMO_DISTRICTS_NOTICE, stateSummary } from "@/lib/franchise-landing";
import { formatPaise } from "@/lib/policy-format";

export const metadata = { title: "Become a Franchise Partner" };
export const dynamic = "force-dynamic";

/**
 * Public opportunity page. Every commercial figure comes from the published, two-admin approved
 * policy; anything not yet decided is shown as "to be announced", never guessed. The page makes no
 * promise about earnings, student numbers or results.
 */
export default function FranchisePage() {
  // Dark launch: the page doesn't exist until NEXT_PUBLIC_FRANCHISE_PUBLIC_ENABLED=true. Checked before
  // anything streams, so a switched-off page still answers 404 rather than a 200 loading screen.
  if (!franchisePublicEnabled()) notFound();
  return (
    <Suspense fallback={<FranchiseSkeleton />}>
      <FranchiseContent />
    </Suspense>
  );
}

function FranchiseSkeleton() {
  return (
    <div className="container-academy py-16 sm:py-24" role="status" aria-live="polite">
      <span className="sr-only">Loading the franchise opportunity…</span>
      <div className="mx-auto max-w-3xl animate-pulse space-y-4" aria-hidden="true">
        <div className="mx-auto h-3 w-40 rounded-full bg-white/10" />
        <div className="mx-auto h-10 w-3/4 rounded-xl bg-white/10" />
        <div className="mx-auto h-4 w-full rounded-full bg-white/5" />
        <div className="mx-auto h-4 w-5/6 rounded-full bg-white/5" />
      </div>
      <div className="mx-auto mt-16 grid max-w-5xl animate-pulse gap-6 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-32" />
        ))}
      </div>
    </div>
  );
}

async function FranchiseContent() {
  const [info, locations, contact] = await Promise.all([
    api.get<FranchiseInfo>("/franchise/info", { token: null }).catch(() => null),
    api.get<{ states: FranchiseState[] }>("/franchise/locations", { token: null }).then((r) => r.states).catch(() => null),
    getShownContact(),
  ]);
  const fee = info?.franchiseFeeInPaise ? formatPaise(info.franchiseFeeInPaise).replace(/\.00$/, "") : null;
  const years = info?.agreementTermMonths ? info.agreementTermMonths / 12 : null;
  const share = info?.revenueShare ?? null;
  const open = Boolean(info?.open);

  return (
    <div className="pb-20">
      {/* Hero */}
      <section className="border-b border-white/5 bg-gradient-to-b from-gold-500/5 to-transparent">
        <div className="container-academy py-16 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">Franchise Opportunity</p>
            <h1 className="mt-3 font-display text-4xl font-bold text-parchment sm:text-5xl">
              Become an ETA <span className="gold-text">Franchise Partner</span>
            </h1>
            <p className="mt-6 text-base leading-relaxed text-parchment-muted">
              Bring E-Commerce Training Academy&apos;s practical e-commerce training to your state. We work with one primary franchise
              partner in each state. Apply for a state that is open, and our team reviews every application.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ApplyButton open={open} />
              <Link href="/franchise/application" className="btn-outline btn-lg">
                Check my application
              </Link>
            </div>
            <p className="mt-4 text-xs text-parchment-muted">Applying is free. It doesn&apos;t reserve a state or guarantee that one will be allocated to you.</p>
          </div>
        </div>
      </section>

      <div className="container-academy">
        {/* Why partner */}
        <Section eyebrow="Why partner with ETA" title="Teach what works, with ETA behind you">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Feature icon={BookOpen} title="A ready curriculum">
              Teach from ETA&apos;s existing courses, which combine self-paced content, live instruction and in-person training.
            </Feature>
            <Feature icon={MapPin} title="Your own state">
              ETA works with one primary franchise partner per state, allocated through a documented approval process.
            </Feature>
            <Feature icon={Users} title="Students on the ETA platform">
              Your students learn on the ETA platform, and you can follow their enrolment from your partner dashboard.
            </Feature>
            <Feature icon={LifeBuoy} title="Support from our team">
              Raise questions with the ETA team through support tickets in your partner dashboard.
            </Feature>
          </div>
        </Section>

        {/* Training and business */}
        <Section eyebrow="The opportunity" title="Training and business information">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-8">
              <BookOpen className="h-6 w-6 text-gold-500" />
              <h3 className="mt-4 font-display text-lg font-semibold text-parchment">What you&apos;ll run</h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-parchment-muted">
                <Bullet>An ETA training centre for e-commerce learners in your state.</Bullet>
                <Bullet>Student enrolment into ETA courses, through the ETA platform.</Bullet>
                <Bullet>Local in-person support for the students you bring in.</Bullet>
              </ul>
            </div>
            <div className="card p-8">
              <Handshake className="h-6 w-6 text-gold-500" />
              <h3 className="mt-4 font-display text-lg font-semibold text-parchment">How the business works</h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-parchment-muted">
                <Bullet>You pay a one-time franchise fee, only after your application is approved and you have the agreement.</Bullet>
                <Bullet>Course revenue from your students is shared between you and ETA, as set out in the published revenue-share policy and your signed agreement.</Bullet>
                <Bullet>Your income depends on your own centre and students. ETA doesn&apos;t promise any level of earnings or student numbers.</Bullet>
              </ul>
            </div>
          </div>
        </Section>

        {/* Proposed terms */}
        <Section id="terms" eyebrow="Proposed terms" title="Commercial terms">
          <div className="grid gap-6 sm:grid-cols-3">
            <Term icon={Building2} label="Franchise fee" value={fee ? `${fee} + applicable GST` : "To be announced"} note={fee && info?.franchiseFeeGst === "PENDING" ? "GST treatment to be confirmed" : null} />
            <Term icon={CalendarClock} label="Agreement duration" value={years ? `${years % 1 === 0 ? years : years.toFixed(1)} years` : "To be announced"} />
            <Term
              icon={Percent}
              label="Proposed revenue share"
              value={share ? `${formatShareBps(share.partnerShareBps)} Partner / ${formatShareBps(share.etaShareBps)} ETA` : "To be announced"}
            />
          </div>
          <div role="note" className="mt-6 rounded-xl border border-gold-500/30 bg-gold-500/5 p-5 text-sm leading-relaxed text-parchment">
            <p className="font-semibold">Proposed terms, subject to final agreement.</p>
            <p className="mt-1 text-parchment-muted">
              These figures come from ETA&apos;s currently published franchise policy. They may change before an agreement is signed, and only the
              signed franchise agreement is binding. No payment is taken when you apply.
            </p>
          </div>
          {!info && <p className="mt-4 text-sm text-parchment-muted">We couldn&apos;t load the current terms right now. Please refresh the page in a moment.</p>}
        </Section>

        {/* States */}
        <Section id="districts" eyebrow="State availability" title="Where you can apply">
          <States states={locations} demo={franchiseDemoData()} />
        </Section>

        {/* Process */}
        <Section eyebrow="Application process" title="How it works">
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Apply", "Sign in with your verified email and complete the three-step form with your documents. No payment is taken."],
              ["Review", "Our team reviews your application and may invite you for a discussion."],
              ["Approval and state allocation", "Approval is a separate decision by our team. A state is closed to others only when its franchise is activated, never by applying."],
              ["Agreement and fee", "Only after approval do you receive the franchise agreement and the fee payment details."],
            ].map(([title, text], i) => (
              <li key={title} className="card p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 font-display text-sm font-bold text-ink" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-parchment">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-parchment-muted">{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Eligibility */}
        <Section eyebrow="Eligibility" title="What you need to apply">
          <div className="card p-8">
            <ul className="grid gap-4 text-sm leading-relaxed text-parchment-muted sm:grid-cols-2">
              <Bullet>An ETA account with a verified email address.</Bullet>
              <Bullet>A 10-digit Indian mobile number.</Bullet>
              <Bullet>Identity proof, plus any other documents the published requirements ask for (such as a photograph or address proof).</Bullet>
              <Bullet>A state that doesn&apos;t already have an active ETA franchise, and a district there for your training centre.</Bullet>
              <Bullet>One active application at a time.</Bullet>
              <Bullet>Readiness to sign the franchise agreement and pay the franchise fee if your application is approved.</Bullet>
            </ul>
          </div>
        </Section>

        {/* FAQ */}
        <Section eyebrow="Questions" title="Frequently asked questions">
          <div className="mx-auto max-w-3xl space-y-3">
            <Faq q="Does applying reserve a state for me?">
              No. States are allocated only through our approval process. Applying doesn&apos;t reserve one or guarantee that it will be allocated to you.
            </Faq>
            <Faq q="Do I pay anything when I apply?">No. You receive the fee payment details only after your application is approved, together with the franchise agreement.</Faq>
            <Faq q="Are earnings guaranteed?">
              No. Your income depends on your own centre and students. ETA doesn&apos;t promise any level of earnings, student numbers or business results.
            </Faq>
            <Faq q="Can the terms change?">
              Yes. The terms shown here are proposed and subject to final agreement. Only the franchise agreement you sign is binding.
            </Faq>
            <Faq q="Who can see my documents?">Your documents are stored privately. Only you and our review team can open them.</Faq>
            <Faq q="What if my state already has a franchise?">It is shown as closed, and it can&apos;t be chosen on the form. You can apply for another state that is open.</Faq>
            <Faq q="How do I follow my application?">
              Sign in and open <Link href="/franchise/application" className="text-gold-400 underline-offset-4 hover:underline">My franchise application</Link> to see each step.
            </Faq>
          </div>
        </Section>

        {/* Contact */}
        <Section eyebrow="Contact and support" title="Talk to us about the franchise">
          <Contact contact={contact} />
        </Section>

        {/* Closing call to action */}
        <section className="card mt-20 flex flex-col items-center gap-5 p-10 text-center">
          <h2 className="font-display text-2xl font-semibold text-parchment sm:text-3xl">Ready to bring ETA to your state?</h2>
          <p className="max-w-xl text-sm text-parchment-muted">Applying takes a few minutes and is free. Our team reviews every application.</p>
          <ApplyButton open={open} />
        </section>
      </div>
    </div>
  );
}

function ApplyButton({ open }: { open: boolean }) {
  return open ? (
    <Link href="/franchise/apply" className="btn-gold btn-lg inline-flex items-center gap-2">
      Apply for Franchise <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <span className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-parchment-muted" role="status">
      Applications open soon
    </span>
  );
}

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-20 scroll-mt-24" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id ? `${id}-title` : undefined} className="mt-2 font-display text-2xl font-semibold text-parchment sm:text-3xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof BookOpen; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <Icon className="h-6 w-6 text-gold-500" aria-hidden="true" />
      <h3 className="mt-4 font-display text-base font-semibold text-parchment">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-parchment-muted">{children}</p>
    </div>
  );
}

function Term({ icon: Icon, label, value, note }: { icon: typeof BookOpen; label: string; value: string; note?: string | null }) {
  return (
    <div className="card p-6">
      <Icon className="h-6 w-6 text-gold-500" aria-hidden="true" />
      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-parchment-muted">{label}</h3>
      <p className="mt-2 font-display text-xl font-semibold text-parchment">{value}</p>
      {note && <p className="mt-1 text-xs text-parchment-muted">{note}</p>}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="card group p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-parchment">
        {q}
        <span className="text-gold-500 transition group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-parchment-muted">{children}</p>
    </details>
  );
}

const AVAILABILITY_BADGE = {
  AVAILABLE: { label: "Available", className: "border-emerald/40 text-emerald" },
  RESERVED: { label: "Reserved", className: "border-amber-500/50 text-amber-400" },
  CLOSED: { label: "Closed", className: "border-white/15 text-parchment-muted" },
} as const;

function States({ states, demo }: { states: FranchiseState[] | null; demo: boolean }) {
  if (states === null) {
    return <p className="card mx-auto max-w-3xl p-6 text-center text-sm text-parchment-muted" role="status">We couldn&apos;t load state availability right now. Please refresh the page in a moment.</p>;
  }
  if (states.length === 0) {
    return <p className="card mx-auto max-w-3xl p-6 text-center text-sm text-parchment-muted">States will be listed here when applications open.</p>;
  }
  const summary = stateSummary(states);
  return (
    <div className="mx-auto max-w-4xl">
      {demo ? (
        <p role="note" className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4 text-center text-sm font-semibold text-parchment">
          {DEMO_DISTRICTS_NOTICE}
        </p>
      ) : (
        <p className="text-center text-sm text-parchment-muted">
          <span className="font-semibold text-parchment">{summary.available}</span> of {summary.total} listed states are open for applications. One franchise per
          state; a state closes only when its franchise is activated.
        </p>
      )}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {summary.rows.map((state) => {
          // Demonstration states are never presented as genuinely available.
          const badge = demo && state.availability === "AVAILABLE" ? { label: "Demo", className: "border-white/15 text-parchment-muted" } : AVAILABILITY_BADGE[state.availability];
          return (
            <li key={state.id} className="card p-5">
              <div className="flex items-center justify-between gap-4">
                <span className="font-semibold text-parchment">{state.name}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
              </div>
              {state.availability === "CLOSED" && <p className="mt-2 text-xs text-parchment-muted">{STATE_CLOSED_MESSAGE}</p>}
              {state.availability === "RESERVED" && <p className="mt-2 text-xs text-parchment-muted">Temporarily reserved while an approved application is completed.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Only real, admin-saved contact details (see shownContact); nothing is shown as a link that goes nowhere. */
function Contact({ contact }: { contact: ShownContact }) {
  const items = [
    contact.email && { icon: Mail, label: "Email", value: contact.email, href: `mailto:${contact.email}` },
    contact.phone && { icon: Phone, label: "Phone", value: contact.phone, href: telHref(contact.phone) },
    contact.whatsapp && { icon: MessageCircle, label: "WhatsApp", value: "Chat with us", href: contact.whatsapp },
    contact.address && { icon: MapPin, label: "Academy address", value: contact.address, href: null },
  ].filter(Boolean) as { icon: typeof Mail; label: string; value: string; href: string | null }[];
  return (
    <div className="mx-auto max-w-4xl">
      {items.length === 0 && (
        <p className="card p-6 text-center text-sm text-parchment-muted">Our franchise contact details will be published here soon.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((c) => {
          const body = (
            <div className="card card-hover flex h-full items-start gap-3 p-5">
              <c.icon className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{c.label}</p>
                <p className="mt-1 break-words text-sm text-parchment">{c.value}</p>
              </div>
            </div>
          );
          return c.href ? (
            <a key={c.label} href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}>
              {body}
            </a>
          ) : (
            <div key={c.label}>{body}</div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-sm text-parchment-muted">
        <ShieldCheck className="mr-2 inline h-4 w-4 align-[-2px] text-gold-500" aria-hidden="true" />
        Already applied? Follow your application under{" "}
        <Link href="/franchise/application" className="text-gold-400 underline-offset-4 hover:underline">
          My franchise application
        </Link>
        .
      </p>
    </div>
  );
}

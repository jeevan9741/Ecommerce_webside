import Link from "next/link";
import { BadgeCheck, BriefcaseBusiness, CalendarDays, Clock, MapPin, ShieldAlert, ShieldX, TriangleAlert, UserRound } from "lucide-react";
import { formatCardDate } from "@/lib/partner-card/design";
import type { PublicPartner } from "@/lib/partner-card/public";

const STATE = {
  VERIFIED: {
    icon: BadgeCheck,
    label: "Verified Business Partner",
    status: "Active",
    ring: "from-emerald-400 to-emerald-600",
    iconCls: "text-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    text: "is an Authorized Business Partner of E-Commerce Training Academy.",
  },
  NOT_YET_VALID: {
    icon: Clock,
    label: "Approved — not yet valid",
    status: "Approved",
    ring: "from-amber-400 to-amber-600",
    iconCls: "text-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    text: "is an approved partner whose card becomes valid on the date below.",
  },
  INACTIVE: {
    icon: ShieldX,
    label: "Card Deactivated",
    status: "Inactive",
    ring: "from-red-400 to-red-600",
    iconCls: "text-red-500",
    chip: "bg-red-50 text-red-700 border-red-200",
    text: "is no longer an active partner. This card is not valid.",
  },
} as const;

function AcademySeal({ verified }: { verified: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-soft bg-ink px-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
      <img src="/brand/card-logo.jpg" alt="" className="h-11 w-11 rounded-full ring-2 ring-yellow-400" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-parchment">E-Commerce Training Academy</p>
        <p className={`flex items-center gap-1 text-xs font-semibold ${verified ? "text-emerald-600" : "text-parchment-muted"}`}>
          {verified ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
          {verified ? "Verified by the academy" : "Academy verification record"}
        </p>
      </div>
    </div>
  );
}

/** The public verification record a card's QR code opens (/verify/…). */
export function PartnerVerification({ partner }: { partner: PublicPartner }) {
  const state = STATE[partner.state];
  const Icon = state.icon;
  const verified = partner.state === "VERIFIED" && partner.qr !== "superseded";

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 bg-gradient-to-br from-[#1424a8] via-[#2335d6] to-[#5b2de6] px-6 pb-16 pt-6 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
        <img src="/brand/card-logo.jpg" alt="E-Commerce Training Academy" className="h-14 w-14 shrink-0 rounded-full ring-4 ring-yellow-400" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-yellow-300">Partner Verification</p>
          <p className="mt-0.5 text-lg font-bold leading-tight">E-Commerce Training Academy</p>
        </div>
      </div>

      <div className="-mt-12 px-6 pb-6">
        <div className="flex flex-col items-center text-center">
          <div className={`rounded-full bg-gradient-to-br p-1 shadow-lg ${state.ring}`}>
            {partner.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL from the register
              <img src={partner.photo} alt={partner.fullName} className="h-24 w-24 rounded-full border-4 border-white object-cover" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-white">
                <Icon className={`h-12 w-12 ${state.iconCls}`} />
              </span>
            )}
          </div>
          <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${state.chip}`}>
            <Icon className="h-3.5 w-3.5" /> {state.label}
          </span>
          <h1 className="mt-3 font-display text-2xl font-bold text-parchment">{partner.fullName}</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            {partner.fullName} {state.text}
          </p>
        </div>

        {partner.qr === "superseded" && (
          <div className="mt-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This QR code is from an older print of the card, which has since been reissued. Ask the partner for their
              current card.
            </p>
          </div>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Detail icon={UserRound} label="Partner ID" value={partner.partnerId} mono />
          <Detail icon={BadgeCheck} label="Status" value={state.status} />
          <Detail icon={BriefcaseBusiness} label="Role" value={partner.role} />
          <Detail icon={CalendarDays} label="Valid from" value={formatCardDate(partner.validFrom)} />
          <Detail icon={MapPin} label="Location" value={partner.location} />
        </dl>

        <div className="mt-6">
          <AcademySeal verified={verified} />
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/verify" className="btn-outline btn-sm">
            Verify another ID
          </Link>
          <Link href="/" className="btn-ghost btn-sm">
            About the academy
          </Link>
        </div>
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, value, mono }: { icon: typeof BadgeCheck; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border-soft bg-ink px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-parchment-muted">{label}</dt>
        <dd className={`truncate text-sm font-semibold text-parchment ${mono ? "font-mono" : ""}`}>{value}</dd>
      </div>
    </div>
  );
}

export function PartnerNotFound({ partnerId }: { partnerId: string }) {
  return (
    <div className="card p-8 text-center">
      <ShieldX className="mx-auto h-12 w-12 text-red-500" />
      <h1 className="mt-4 font-display text-2xl font-bold text-parchment">Not a verified partner</h1>
      <p className="mt-2 text-sm text-parchment-muted">
        <span className="font-mono font-semibold text-parchment">{partnerId}</span> is not in the E-Commerce Training
        Academy partner register. Treat this card as invalid.
      </p>
      <Link href="/verify" className="btn-outline btn-sm mt-6">
        Check another ID
      </Link>
    </div>
  );
}

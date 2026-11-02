const TONE: Record<string, string> = {
  ACTIVE: "border-emerald/30 bg-emerald/10 text-emerald",
  SUSPENDED: "border-gold-500/30 bg-gold-500/10 text-gold-600",
  DEACTIVATED: "border-danger/30 bg-danger/10 text-danger",
  EXPIRED: "border-slate-200 bg-slate-100 text-slate-700",
};

/** Franchise partner status badge (admin pages; same palette as the other admin badges). */
export function PartnerStatus({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[status] ?? TONE.EXPIRED}`}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

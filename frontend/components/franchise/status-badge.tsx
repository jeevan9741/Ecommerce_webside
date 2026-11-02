import { STATUS_LABEL, statusTone } from "@/lib/franchise-review";

// Same badge palette as the other admin pages (light theme).
const TONE: Record<string, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  info: "border-gold-500/30 bg-gold-500/10 text-gold-600",
  good: "border-emerald/30 bg-emerald/10 text-emerald",
  bad: "border-danger/30 bg-danger/10 text-danger",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[statusTone(status)]}`}>
      {label ?? STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
    </span>
  );
}

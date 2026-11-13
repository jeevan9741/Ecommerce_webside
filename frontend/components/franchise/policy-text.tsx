import { AlertTriangle } from "lucide-react";
import { isDraftPolicyText } from "@/lib/franchise-landing";

/**
 * A published policy text with its version. Text marked as a sample or draft (e.g. the local preview's
 * "LOCAL PREVIEW SAMPLE — not an approved ETA policy") gets a prominent warning, so placeholder wording
 * is never presented as an approved policy.
 */
export function PolicyText({ title, version, text, scroll = false }: { title: string; version: number; text: string; scroll?: boolean }) {
  const draft = isDraftPolicyText(text);
  return (
    <div className="space-y-3">
      <p className="text-xs text-parchment-muted">
        {title} · version {version}
      </p>
      {draft && (
        <p role="note" className="flex items-start gap-2 rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-3 text-sm font-semibold text-parchment">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>
            Draft — not an approved policy. This text is a placeholder and does not describe ETA&apos;s actual {title.toLowerCase()}.
          </span>
        </p>
      )}
      <div
        className={`whitespace-pre-line text-sm leading-relaxed text-parchment-muted ${scroll ? "max-h-48 overflow-y-auto rounded-lg border border-white/10 p-4" : ""}`}
        tabIndex={scroll ? 0 : undefined}
        aria-label={scroll ? `${title}, version ${version}${draft ? " (draft)" : ""}` : undefined}
      >
        {text}
      </div>
    </div>
  );
}

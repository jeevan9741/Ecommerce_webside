import type { LucideIcon } from "lucide-react";
import { Calendar, Clock, ExternalLink, Info, ListChecks, MapPin } from "lucide-react";
import { CENTRE_PENDING, centreDisplay } from "@/lib/centre-details";

/** Venue, dates and inclusions for an offline centre package — only what the academy configured. */
export function CentreDetails({ metadata }: { metadata: unknown }) {
  const d = centreDisplay(metadata);
  return (
    <div className="mt-8 space-y-4">
      <DetailCard icon={MapPin} title="Academy Centre Address" value={d.address}>
        {d.mapUrl && (
          <a href={d.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-gold-500 hover:underline">
            Open in maps <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </DetailCard>
      <DetailCard icon={Calendar} title="Batch Dates" value={d.dates} />
      <DetailCard icon={Clock} title="Schedule" value={d.schedule} />
      <DetailCard icon={ListChecks} title="What's Included" value={d.inclusions.length ? "" : null}>
        {d.inclusions.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-parchment-muted">
            {d.inclusions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </DetailCard>
      {d.notes && <DetailCard icon={Info} title="Notes" value={d.notes} />}
    </div>
  );
}

function DetailCard({ icon: Icon, title, value, children }: { icon: LucideIcon; title: string; value: string | null; children?: React.ReactNode }) {
  return (
    <div className="card p-6">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-5 w-5 text-gold-500" />
        <h3 className="font-semibold text-parchment">{title}</h3>
      </div>
      {value === null ? (
        <p className="text-sm italic text-parchment-muted">{CENTRE_PENDING}</p>
      ) : (
        value && <p className="whitespace-pre-line text-sm text-parchment-muted">{value}</p>
      )}
      {children}
    </div>
  );
}

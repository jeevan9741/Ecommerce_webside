/** The systems that don't exist yet, shown honestly on admin franchise pages (never as figures or statuses). */
export const NOT_IMPLEMENTED_MESSAGE = "Not available until the relevant system is implemented.";
const SYSTEMS = ["Franchise fee payment verification", "Signed franchise agreement", "E-signing", "Franchise earnings and payouts"];

export function AdminUnavailableSystems({ note }: { note?: string }) {
  return (
    <section className="card p-6" aria-labelledby="unavailable-systems">
      <h2 id="unavailable-systems" className="font-display text-lg font-semibold text-parchment">Payment, agreement and payouts</h2>
      {note && <p className="mt-1 text-xs text-parchment-muted">{note}</p>}
      <ul className="mt-3 space-y-2 text-sm">
        {SYSTEMS.map((s) => (
          <li key={s} className="rounded-lg border border-white/5 px-3 py-2">
            <p className="text-parchment">{s}</p>
            <p className="text-xs text-parchment-muted">{NOT_IMPLEMENTED_MESSAGE}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

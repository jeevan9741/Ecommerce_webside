"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Upload } from "lucide-react";
import { api } from "@/lib/api";

interface District {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  held: boolean;
  openApplications: number;
}
interface State {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  districts: District[];
}
interface Preview {
  source: string | null;
  fileSha256: string;
  rows: number;
  states: number;
  plan: { newStates: number; renamedStates: number; newDistricts: number; renamedDistricts: number; movedDistricts: number; unchanged: number };
  notInFile: number;
  changes: {
    addedStates: { code: string; name: string }[];
    renamedStates: { code: string; from: string; to: string }[];
    addedDistricts: { stateCode: string; code: string; name: string }[];
    renamedDistricts: { code: string; from: string; to: string }[];
    missingDistricts: { code: string; name: string; stateCode: string | null }[];
  };
  listLimit: number;
  errors: string[];
  errorCount: number;
  valid: boolean;
}

const fetchStates = () => api.get<{ states: State[] }>("/admin/franchise/locations").then((r) => r.states);
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * States/UTs and districts for franchise applications. Nothing here is ever deleted — locations are
 * referenced by applications and allocations — so the only "removal" is disabling. Imports take the
 * official LGD extract as CSV, show exactly what would change, and apply only the file reviewed.
 */
export default function FranchiseLocationsPage() {
  const [states, setStates] = useState<State[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStates(await fetchStates());
    } catch (err) {
      setError(message(err));
    }
  }, []);
  useEffect(() => {
    fetchStates().then(setStates, (err) => setError(message(err)));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const totalDistricts = states?.reduce((n, s) => n + s.districts.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Locations</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          {states ? `${states.length} states / UTs, ${totalDistricts} districts.` : "Loading…"} New locations start disabled. Enable a state only after checking it and its districts
          against the official LGD list. Nothing is ever deleted.
        </p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <ImportPanel onApplied={load} />

      <AddState busy={busy} onAdd={(name, code) => run(() => api.post("/admin/franchise/locations/states", { name, code }))} />

      <div className="card divide-y divide-white/5">
        {states?.map((s) => (
          <div key={s.id} className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="flex items-center gap-1 text-left text-sm font-semibold text-parchment" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} aria-expanded={!!open[s.id]}>
                {open[s.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {s.name}
              </button>
              <span className="text-xs text-parchment-muted">{s.code ? `LGD ${s.code}` : "no code"} · {s.districts.length} districts</span>
              {!s.isActive && <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-parchment-muted">Disabled</span>}
              <span className="ml-auto" />
              {s.isActive ? (
                <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => run(() => api.patch(`/admin/franchise/locations/states/${s.id}`, { isActive: false }))}>
                  Disable
                </button>
              ) : (
                <EnableState state={s} busy={busy} onEnable={(expectedDistricts) => run(() => api.post(`/admin/franchise/locations/states/${s.id}/activate`, { confirm: true, expectedDistricts }))} />
              )}
            </div>
            {open[s.id] && (
              <div className="mt-3 space-y-2 pl-5">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-parchment-muted">
                    <tr>
                      <th className="py-1 font-medium">District</th>
                      <th className="py-1 font-medium">LGD code</th>
                      <th className="py-1 font-medium">Status</th>
                      <th className="py-1 font-medium">Open applications</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.districts.map((d) => (
                      <tr key={d.id} className="border-t border-white/5">
                        <td className="py-1.5 text-parchment">{d.name}</td>
                        <td className="py-1.5 text-parchment-muted">{d.code ?? "—"}</td>
                        <td className="py-1.5 text-parchment-muted">{!d.isActive ? "Disabled (not offered)" : d.held ? "Held by a franchise" : "Available"}</td>
                        <td className="py-1.5 text-parchment-muted">{d.openApplications}</td>
                        <td className="py-1.5 text-right">
                          {d.isActive ? (
                            <button type="button" disabled={busy} className="btn-ghost btn-sm" onClick={() => run(() => api.patch(`/admin/franchise/locations/districts/${d.id}`, { isActive: false }))}>
                              Disable
                            </button>
                          ) : (
                            <EnableDistrict busy={busy} name={d.name} onEnable={() => run(() => api.patch(`/admin/franchise/locations/districts/${d.id}`, { isActive: true, confirm: true }))} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <AddDistrict busy={busy} onAdd={(name, code) => run(() => api.post("/admin/franchise/locations/districts", { stateId: s.id, name, code }))} />
              </div>
            )}
          </div>
        ))}
        {states?.length === 0 && <p className="p-4 text-sm text-parchment-muted">No locations yet. Import the official LGD list or add them one by one.</p>}
      </div>
    </div>
  );
}

function AddState({ busy, onAdd }: { busy: boolean; onAdd: (name: string, code: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name, code);
        setName("");
        setCode("");
      }}
    >
      <div className="min-w-48 flex-1">
        <label htmlFor="new-state" className="label-field">New state / UT</label>
        <input id="new-state" className="input-field text-sm" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} />
      </div>
      <div className="w-36">
        <label htmlFor="new-state-code" className="label-field">LGD code</label>
        <input id="new-state-code" className="input-field text-sm" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button type="submit" disabled={busy} className="btn-outline btn-sm">Add state</button>
    </form>
  );
}

function AddDistrict({ busy, onAdd }: { busy: boolean; onAdd: (name: string, code: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name, code);
        setName("");
        setCode("");
      }}
    >
      <input aria-label="District name" placeholder="District name" className="input-field !w-56 text-sm" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} />
      <input aria-label="District LGD code" placeholder="LGD code" inputMode="numeric" className="input-field !w-32 text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="submit" disabled={busy} className="btn-ghost btn-sm">Add district</button>
    </form>
  );
}

function EnableDistrict({ busy, name, onEnable }: { busy: boolean; name: string; onEnable: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2 text-xs text-parchment-muted">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" aria-label={`${name} verified against the official LGD list`} checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Verified (LGD)
      </label>
      <button type="button" disabled={busy || !checked} className="btn-outline btn-sm" onClick={onEnable}>
        Enable
      </button>
    </span>
  );
}

function EnableState({ state, busy, onEnable }: { state: State; busy: boolean; onEnable: (expectedDistricts: number) => void }) {
  const [checked, setChecked] = useState(false);
  const disabledCount = state.districts.filter((d) => !d.isActive).length;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-parchment-muted">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        Verified against the official LGD list
      </label>
      <button type="button" disabled={busy || !checked} className="btn-outline btn-sm" onClick={() => onEnable(disabledCount)}>
        Enable state + {disabledCount} district{disabledCount === 1 ? "" : "s"}
      </button>
    </span>
  );
}

function ChangeList<T>({ title, items, total, render }: { title: string; items: T[]; total: number; render: (item: T) => string }) {
  if (total === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-parchment">
        {title}: {total}
      </summary>
      <ul className="mt-1 max-h-48 overflow-y-auto pl-4 text-parchment-muted">
        {items.map((item, i) => (
          <li key={i}>{render(item)}</li>
        ))}
        {total > items.length && <li>…and {total - items.length} more</li>}
      </ul>
    </details>
  );
}

function ImportPanel({ onApplied }: { onApplied: () => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setConfirmed(false);
    setDone(null);
  };
  async function readFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) return setError("The file is larger than 2 MB.");
    setCsv(await f.text());
    reset();
  }
  async function doPreview() {
    setBusy(true);
    setError(null);
    reset();
    try {
      setPreview(await api.post<Preview>("/admin/franchise/locations/import/preview", { csv, source }));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function doApply() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/admin/franchise/locations/import/apply", { csv, expectedSha256: preview.fileSha256, source: preview.source, confirm: true });
      setDone(`Imported ${preview.rows} rows. New locations are disabled until you verify and enable them.`);
      setPreview(null);
      setConfirmed(false);
      await onApplied();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-parchment">Import from the official LGD list (CSV)</summary>
      <div className="mt-4 space-y-3 text-sm">
        <p className="text-xs text-parchment-muted">
          Columns: <code>state_code,state_name,district_code,district_name</code>. Matching is by official code. Imports add and rename only, and new rows start disabled. Anything
          missing from the file is listed, never removed.
        </p>
        <div>
          <label htmlFor="import-source" className="label-field">Source (required)</label>
          <input
            id="import-source"
            className="input-field text-sm"
            placeholder="e.g. LGD district list, lgdirectory.gov.in, downloaded 2026-11-02 by <name>"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              reset();
            }}
          />
        </div>
        <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} className="input-field text-sm" aria-label="CSV file" />
        {csv && <p className="text-xs text-parchment-muted">{csv.split(/\r?\n/).filter(Boolean).length - 1} data rows loaded.</p>}
        <button type="button" disabled={!csv || source.trim().length < 5 || busy} onClick={doPreview} className="btn-outline btn-sm inline-flex items-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Preview changes
        </button>
        {preview && (
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
            <p className="text-xs text-parchment-muted">Source: {preview.source}</p>
            <p className="text-xs text-parchment-muted [overflow-wrap:anywhere]">File SHA-256: {preview.fileSha256}</p>
            <p className="text-parchment">
              {preview.rows} rows, {preview.states} states. Unchanged: {preview.plan.unchanged}.
            </p>
            <ChangeList title="States added" items={preview.changes.addedStates} total={preview.plan.newStates} render={(x) => `${x.code} ${x.name}`} />
            <ChangeList title="States renamed" items={preview.changes.renamedStates} total={preview.plan.renamedStates} render={(x) => `${x.code}: ${x.from} → ${x.to}`} />
            <ChangeList title="Districts added" items={preview.changes.addedDistricts} total={preview.plan.newDistricts} render={(x) => `${x.code} ${x.name} (state ${x.stateCode})`} />
            <ChangeList title="Districts renamed" items={preview.changes.renamedDistricts} total={preview.plan.renamedDistricts} render={(x) => `${x.code}: ${x.from} → ${x.to}`} />
            <ChangeList title="Existing districts missing from this file (kept)" items={preview.changes.missingDistricts} total={preview.notInFile} render={(x) => `${x.code || "no code"} ${x.name}`} />
            {preview.errors.length > 0 && (
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-xs text-danger">
                {preview.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {preview.errorCount > preview.errors.length && <li>…and {preview.errorCount - preview.errors.length} more</li>}
              </ul>
            )}
            {preview.valid && (
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-xs text-parchment">
                  <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I reviewed these changes, and this file is the official LGD download named above.
                </label>
                <button type="button" disabled={busy || !confirmed} onClick={doApply} className="btn-gold btn-sm">
                  Apply this file
                </button>
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {done && <p role="status" className="text-emerald">{done}</p>}
      </div>
    </details>
  );
}

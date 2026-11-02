"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, ShieldCheck } from "lucide-react";
import { backendFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";
import { DOMAIN_LABEL, PENDING, STATUS_LABEL, describeValue, formatBps, isPending, paiseToRupeesInput, rupeesToPaise, shortSha } from "@/lib/policy-format";

type Payload = Record<string, unknown>;
interface Field {
  key: string;
  label: string;
  kind: string;
  pendingAllowed: boolean;
  pendingOnly?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  help?: string;
}
interface SchemaResponse {
  domains: string[];
  fields: Record<string, Field[]>;
  startingValues: Record<string, Payload>;
}
interface Person {
  id: string;
  name: string;
}
interface Policy {
  id: string;
  domain: string;
  version: number;
  status: string;
  payload: Payload;
  payloadSha256: string;
  effectiveFrom: string | null;
  publishedAt: string | null;
  createdAt: string;
  createdBy: Person;
  approvedBy: Person | null;
}
interface Approval {
  id: string;
  status: string;
  reason: string;
  payloadSha256: string;
  payload: { effectiveFrom?: string | null };
  createdAt: string;
  expiresAt: string;
  decisionNote: string | null;
  requestedBy: Person;
  decidedBy: Person | null;
  policy: { id: string; domain: string; version: number; status: string } | null;
}
interface Readiness {
  twoAdmin: { adminCount: number; available: boolean };
  domains: { domain: string; current: { id: string; version: number; effectiveFrom: string; pending: string[] } | null; upcoming: { version: number; effectiveFrom: string } | null; awaitingApproval: number }[];
  features: { feature: string; policiesComplete: boolean; blockers: string[]; activated: boolean }[];
}
interface Diff {
  base: { version: number; payloadSha256: string } | null;
  changes: { path: string; change: string; before?: unknown; after?: unknown }[];
}
interface ApiError {
  error?: string;
  code?: string;
  issues?: { path: string; message: string }[];
  blockers?: string[];
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; data: T & ApiError }> {
  const res = await backendFetch(`/api${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  return { ok: res.ok, data };
}

export default function FranchisePoliciesPage() {
  const { user } = useAuth();
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [domain, setDomain] = useState("COMMERCIAL");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; issues?: ApiError["issues"] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, a, r] = await Promise.all([
      api<{ policies: Policy[] }>("/admin/franchise/policies"),
      api<{ approvals: Approval[] }>("/admin/franchise/approvals?status=PENDING"),
      api<Readiness>("/admin/franchise/policies/readiness"),
    ]);
    if (p.ok) setPolicies(p.data.policies);
    if (a.ok) setApprovals(a.data.approvals);
    if (r.ok) setReadiness(r.data);
  }, []);

  useEffect(() => {
    api<SchemaResponse>("/admin/franchise/policies/schema").then((r) => r.ok && setSchema(r.data));
    Promise.all([
      api<{ policies: Policy[] }>("/admin/franchise/policies"),
      api<{ approvals: Approval[] }>("/admin/franchise/approvals?status=PENDING"),
      api<Readiness>("/admin/franchise/policies/readiness"),
    ]).then(([p, a, r]) => {
      if (p.ok) setPolicies(p.data.policies);
      if (a.ok) setApprovals(a.data.approvals);
      if (r.ok) setReadiness(r.data);
    });
  }, []);

  const run = async (fn: () => Promise<{ ok: boolean; data: ApiError }>, success: string) => {
    setBusy(true);
    setMessage(null);
    const r = await fn();
    setMessage(r.ok ? { tone: "ok", text: success } : { tone: "error", text: r.data.error ?? "Request failed", issues: r.data.issues });
    await load();
    setBusy(false);
    return r.ok;
  };

  const domainPolicies = policies.filter((p) => p.domain === domain);
  const myDraft = domainPolicies.find((p) => p.status === "DRAFT" && p.createdBy.id === user?.id) ?? null;
  const domainReadiness = readiness?.domains.find((d) => d.domain === domain);

  if (!schema) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Franchise Policies</h1>
        <p className="mt-1 max-w-3xl text-sm text-parchment-muted">
          Versioned business configuration for the franchise system. A change is drafted by one admin and takes effect only when a
          different admin approves the exact version they reviewed. Published versions never change. Undecided items stay PENDING —
          and completing a policy never switches a financial feature on by itself.
        </p>
      </div>

      {message && (
        <div className={`card p-4 text-sm ${message.tone === "ok" ? "text-emerald" : "text-danger"}`} role="status">
          {message.text}
          {message.issues && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {message.issues.map((i) => (
                <li key={`${i.path}${i.message}`}>
                  <span className="font-mono">{i.path}</span>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {readiness && <ReadinessPanel readiness={readiness} />}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Policy domain">
        {schema.domains.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={d === domain}
            onClick={() => setDomain(d)}
            className={`rounded-full border px-4 py-1.5 text-sm ${d === domain ? "border-gold-500 bg-gold-500/10 text-parchment" : "border-border-strong text-parchment-muted"}`}
          >
            {DOMAIN_LABEL[d] ?? d}
          </button>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="text-lg font-semibold text-parchment">In force now</h2>
        {domainReadiness?.current ? (
          <p className="mt-1 text-sm text-parchment-muted">
            Version {domainReadiness.current.version} since {formatDateTime(domainReadiness.current.effectiveFrom)}
            {domainReadiness.current.pending.length > 0 && <> · pending: {domainReadiness.current.pending.join(", ")}</>}
            {domainReadiness.upcoming && (
              <> · version {domainReadiness.upcoming.version} takes effect {formatDateTime(domainReadiness.upcoming.effectiveFrom)}</>
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-parchment-muted">No version of this policy has been published yet.</p>
        )}
        <PolicyTable fields={schema.fields[domain]} policy={domainPolicies.find((p) => p.id === domainReadiness?.current?.id) ?? null} />
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-parchment">Your draft</h2>
          {!myDraft && (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                className="btn-outline !px-3 !py-1.5 text-xs"
                onClick={() => run(() => api("/admin/franchise/policies", { method: "POST", body: JSON.stringify({ domain, from: "STARTING_VALUES" }) }), "Draft created from the approved business configuration.")}
              >
                New draft from approved configuration
              </button>
              {domainReadiness?.current && (
                <button
                  disabled={busy}
                  className="btn-outline !px-3 !py-1.5 text-xs"
                  onClick={() => run(() => api("/admin/franchise/policies", { method: "POST", body: JSON.stringify({ domain, from: "CURRENT" }) }), "Draft created from the version in force.")}
                >
                  New draft from current version
                </button>
              )}
            </div>
          )}
        </div>
        {myDraft ? (
          <DraftEditor key={`${myDraft.id}:${myDraft.payloadSha256}`} draft={myDraft} fields={schema.fields[domain]} busy={busy} run={run} twoAdminAvailable={readiness?.twoAdmin.available ?? false} />
        ) : (
          <p className="mt-2 text-sm text-parchment-muted">You have no draft for this policy.</p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold text-parchment">Awaiting approval</h2>
        {approvals.length === 0 ? (
          <p className="mt-2 text-sm text-parchment-muted">Nothing is waiting for a decision.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {approvals.map((a) => (
              <ApprovalCard key={a.id} approval={a} me={user?.id ?? ""} busy={busy} run={run} />
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-x-auto p-5">
        <h2 className="text-lg font-semibold text-parchment">History</h2>
        <table className="mt-3 w-full min-w-[640px] text-left text-xs text-parchment-muted">
          <thead>
            <tr className="text-parchment">
              <th className="py-1 pr-3">Version</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Drafted by</th>
              <th className="py-1 pr-3">Approved by</th>
              <th className="py-1 pr-3">Effective from</th>
              <th className="py-1 pr-3">Payload hash</th>
            </tr>
          </thead>
          <tbody>
            {domainPolicies.map((p) => (
              <tr key={p.id} className="border-t border-border-strong">
                <td className="py-1.5 pr-3">v{p.version}</td>
                <td className="py-1.5 pr-3">{STATUS_LABEL[p.status] ?? p.status}</td>
                <td className="py-1.5 pr-3">{p.createdBy.name}</td>
                <td className="py-1.5 pr-3">{p.approvedBy?.name ?? "—"}</td>
                <td className="py-1.5 pr-3">{p.effectiveFrom ? formatDateTime(p.effectiveFrom) : "—"}</td>
                <td className="py-1.5 pr-3 font-mono">{shortSha(p.payloadSha256)}</td>
              </tr>
            ))}
            {domainPolicies.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3">
                  No versions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        {readiness.twoAdmin.available ? <ShieldCheck className="h-5 w-5 text-emerald" /> : <AlertTriangle className="h-5 w-5 text-danger" />}
        <h2 className="text-lg font-semibold text-parchment">Readiness</h2>
      </div>
      <p className="mt-1 text-sm text-parchment-muted">
        {readiness.twoAdmin.available
          ? `${readiness.twoAdmin.adminCount} admin accounts — two-admin approval is possible.`
          : `Only ${readiness.twoAdmin.adminCount} admin account exists. Policies can be drafted, but nothing can be published until a second authorised admin is set up.`}
      </p>
      <ul className="mt-3 grid gap-2 text-xs md:grid-cols-2">
        {readiness.features.map((f) => (
          <li key={f.feature} className="rounded-lg border border-border-strong p-3">
            <p className="flex items-center gap-1.5 font-medium text-parchment">
              {f.policiesComplete ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald" /> : <Lock className="h-3.5 w-3.5" />}
              {f.feature.replaceAll("_", " ").toLowerCase()}
            </p>
            <p className="mt-1 text-parchment-muted">
              {f.policiesComplete ? "All required decisions are published." : `Blocked: ${f.blockers.join("; ")}.`} Not activated — activation is a separate approval.
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PolicyTable({ fields, policy }: { fields: Field[]; policy: Policy | null }) {
  if (!policy) return null;
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-xs text-parchment-muted">{f.label}</dt>
          <dd className={`[overflow-wrap:anywhere] ${isPending(policy.payload[f.key]) ? "text-gold-400" : "text-parchment"}`}>{describeValue(f.kind, policy.payload[f.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; data: ApiError }>, success: string) => Promise<boolean>;

function DraftEditor({ draft, fields, busy, run, twoAdminAvailable }: { draft: Policy; fields: Field[]; busy: boolean; run: Run; twoAdminAvailable: boolean }) {
  const [payload, setPayload] = useState<Payload>(draft.payload);
  const [rupeeInputs, setRupeeInputs] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [diff, setDiff] = useState<Diff | null>(null);
  const dirty = useMemo(() => JSON.stringify(payload) !== JSON.stringify(draft.payload), [payload, draft.payload]);

  useEffect(() => {
    api<Diff>(`/admin/franchise/policies/${draft.id}/diff`).then((r) => r.ok && setDiff(r.data));
  }, [draft.id, draft.payloadSha256]);

  const set = (key: string, value: unknown) => setPayload((p) => ({ ...p, [key]: value }));
  const save = () => run(() => api(`/admin/franchise/policies/${draft.id}`, { method: "PUT", body: JSON.stringify({ payload, expectedSha: draft.payloadSha256 }) }), "Draft saved.");

  return (
    <div className="mt-3 space-y-4">
      <p className="text-xs text-parchment-muted">
        Version {draft.version} · hash <span className="font-mono">{shortSha(draft.payloadSha256)}</span>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={payload[f.key]}
            rupees={rupeeInputs[f.key]}
            onRupees={(text) => {
              setRupeeInputs((r) => ({ ...r, [f.key]: text }));
              const paise = rupeesToPaise(text);
              set(f.key, paise ?? text);
            }}
            onChange={(v) => set(f.key, v)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !dirty} onClick={save} className="btn-gold !px-3 !py-1.5 text-xs">
          Save draft
        </button>
        <button
          disabled={busy}
          onClick={() => run(() => api(`/admin/franchise/policies/${draft.id}`, { method: "DELETE", body: JSON.stringify({ expectedSha: draft.payloadSha256 }) }), "Draft discarded.")}
          className="btn-outline !border-danger !px-3 !py-1.5 text-xs !text-danger"
        >
          Discard draft
        </button>
      </div>

      <div className="rounded-lg border border-border-strong p-4">
        <h3 className="text-sm font-semibold text-parchment">Changes against the version in force</h3>
        <DiffList diff={diff} fields={fields} />
      </div>

      <div className="rounded-lg border border-border-strong p-4">
        <h3 className="text-sm font-semibold text-parchment">Submit for approval</h3>
        <p className="mt-1 text-xs text-parchment-muted">
          A different admin must approve the saved version (hash {shortSha(draft.payloadSha256)}). Save first if you changed anything.
        </p>
        <label className="mt-3 block text-xs text-parchment-muted" htmlFor="reason">
          Reason for the change (required)
        </label>
        <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="input-field mt-1 w-full text-sm" />
        <label className="mt-3 block text-xs text-parchment-muted" htmlFor="effective">
          Takes effect (optional — empty means on approval; never in the past)
        </label>
        <input id="effective" type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-field mt-1 text-sm" />
        <div className="mt-3">
          <button
            disabled={busy || dirty || reason.trim().length < 5 || !twoAdminAvailable}
            onClick={() =>
              run(
                () =>
                  api(`/admin/franchise/policies/${draft.id}/submit`, {
                    method: "POST",
                    body: JSON.stringify({ expectedSha: draft.payloadSha256, reason, effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : null }),
                  }),
                "Submitted. Another admin must now approve it."
              )
            }
            className="btn-gold !px-3 !py-1.5 text-xs"
          >
            Submit for approval
          </button>
          {!twoAdminAvailable && <p className="mt-2 text-xs text-danger">Submission needs a second authorised admin account to exist.</p>}
        </div>
      </div>
    </div>
  );
}

const DOCUMENT_LABEL = { PHOTO: "Photograph", ADDRESS_PROOF: "Address proof", BUSINESS_PLAN: "Business plan" } as const;

function FieldInput({ field, value, rupees, onRupees, onChange }: { field: Field; value: unknown; rupees?: string; onRupees: (t: string) => void; onChange: (v: unknown) => void }) {
  const pending = isPending(value);
  const id = `f-${field.key}`;
  const control = () => {
    switch (field.kind) {
      case "paise":
        return (
          <div>
            <input id={id} inputMode="decimal" className="input-field mt-1 text-sm" value={rupees ?? (typeof value === "string" ? paiseToRupeesInput(value) : "")} onChange={(e) => onRupees(e.target.value)} />
            <p className="mt-1 text-xs text-parchment-muted">{describeValue("paise", value)}</p>
          </div>
        );
      case "bps":
        return (
          <div>
            <input id={id} type="number" step={1} min={0} max={10000} className="input-field mt-1 text-sm" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
            <p className="mt-1 text-xs text-parchment-muted">{typeof value === "number" ? formatBps(value) : ""}</p>
          </div>
        );
      case "int":
        return <input id={id} type="number" step={1} min={field.min} max={field.max} className="input-field mt-1 text-sm" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
      case "enum":
        return (
          <select id={id} className="input-field mt-1 text-sm" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "time":
        return <input id={id} type="time" className="input-field mt-1 text-sm" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
      case "text":
        return <textarea id={id} rows={3} className="input-field mt-1 w-full text-sm" value={(value as { text?: string })?.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} />;
      case "channels": {
        const list = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="mt-1 flex gap-4 text-sm">
            {field.options?.map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </div>
        );
      }
      case "gst": {
        const g = (value ?? {}) as { mode?: string; rateBps?: number };
        return (
          <div className="mt-1 flex flex-wrap gap-2">
            <select aria-label="GST mode" className="input-field !w-auto text-sm" value={g.mode ?? ""} onChange={(e) => onChange({ ...g, mode: e.target.value })}>
              <option value="">Mode…</option>
              <option value="INCLUSIVE">GST inclusive</option>
              <option value="EXCLUSIVE">GST extra</option>
            </select>
            <input aria-label="GST rate (basis points)" type="number" step={1} min={0} max={2800} className="input-field !w-32 text-sm" placeholder="bps" value={g.rateBps ?? ""} onChange={(e) => onChange({ ...g, rateBps: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
        );
      }
      case "documents": {
        const docs = (value ?? {}) as Record<string, string>;
        return (
          <div className="mt-1 grid gap-2 text-sm">
            <p className="text-xs text-parchment-muted">ID proof: always required</p>
            {(["PHOTO", "ADDRESS_PROOF", "BUSINESS_PLAN"] as const).map((k) => (
              <label key={k} className="flex items-center justify-between gap-2">
                <span className="text-xs">{DOCUMENT_LABEL[k]}</span>
                <select aria-label={DOCUMENT_LABEL[k]} className="input-field !w-auto text-sm" value={docs[k] ?? ""} onChange={(e) => onChange({ ...docs, [k]: e.target.value })}>
                  <option value="">Choose…</option>
                  {field.options?.map((o) => (
                    <option key={o} value={o}>
                      {o.replace("_", " ").toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        );
      }
      case "tds": {
        const t = (value ?? {}) as Record<string, unknown>;
        const put = (k: string, v: unknown) => onChange({ ...t, [k]: v });
        return (
          <div className="mt-1 grid gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={t.applicable === true} onChange={(e) => put("applicable", e.target.checked)} /> TDS applicable
            </label>
            <input aria-label="TDS rate (basis points)" type="number" step={1} className="input-field text-sm" placeholder="Rate (bps)" value={(t.rateBps as number | undefined) ?? ""} onChange={(e) => put("rateBps", e.target.value === "" ? undefined : Number(e.target.value))} />
            <input aria-label="Threshold (paise)" inputMode="numeric" className="input-field text-sm" placeholder="Threshold (paise)" value={(t.thresholdInPaise as string | undefined) ?? ""} onChange={(e) => put("thresholdInPaise", e.target.value)} />
            <select aria-label="Timing" className="input-field text-sm" value={(t.timing as string | undefined) ?? ""} onChange={(e) => put("timing", e.target.value)}>
              <option value="">Timing…</option>
              <option value="ON_CREDIT">On credit</option>
              <option value="ON_PAYOUT">On payout</option>
            </select>
            <input aria-label="Provision reference" className="input-field text-sm" placeholder="Provision (Income-tax Act, 2025) as confirmed by the CA" value={(t.provisionReference as string | undefined) ?? ""} onChange={(e) => put("provisionReference", e.target.value)} />
            <input aria-label="Confirmed by" className="input-field text-sm" placeholder="Confirmed by (CA name / firm)" value={(t.confirmedBy as string | undefined) ?? ""} onChange={(e) => put("confirmedBy", e.target.value)} />
          </div>
        );
      }
      default:
        return <p className="mt-1 text-sm text-parchment">{describeValue(field.kind, value)}</p>;
    }
  };

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-parchment">
        {field.label}
      </label>
      {field.help && <p className="text-xs text-parchment-muted">{field.help}</p>}
      {field.pendingOnly ? (
        <p className="mt-1 text-sm text-gold-400">PENDING — set when the decision is approved</p>
      ) : field.kind === "fixed" ? (
        <p className="mt-1 text-sm text-parchment">{String(value)}</p>
      ) : (
        <>
          {field.pendingAllowed && (
            <label className="mt-1 flex items-center gap-1.5 text-xs text-parchment-muted">
              <input type="checkbox" checked={pending} onChange={(e) => onChange(e.target.checked ? PENDING : field.kind === "channels" ? [] : field.kind === "text" ? { text: "" } : field.kind === "gst" || field.kind === "tds" || field.kind === "documents" ? {} : "")} />
              Decision pending
            </label>
          )}
          {!pending && control()}
        </>
      )}
    </div>
  );
}

function DiffList({ diff, fields }: { diff: Diff | null; fields: Field[] }) {
  if (!diff) return <p className="mt-2 text-xs text-parchment-muted">Loading…</p>;
  if (diff.changes.length === 0) return <p className="mt-2 text-xs text-parchment-muted">No changes{diff.base ? ` from v${diff.base.version}` : ""}.</p>;
  const kindOf = (path: string) => fields.find((f) => f.key === path.split(".")[0])?.kind ?? "";
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {diff.changes.map((c) => (
        <li key={c.path} className="[overflow-wrap:anywhere]">
          <span className="font-mono text-parchment">{c.path}</span>{" "}
          <span className="text-parchment-muted">
            {c.change === "added" ? "added" : c.change === "removed" ? "removed" : "changed"}: {c.change !== "added" && describeValue(kindOf(c.path), c.before)}
            {c.change === "changed" && " → "}
            {c.change !== "removed" && describeValue(kindOf(c.path), c.after)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ApprovalCard({ approval, me, busy, run }: { approval: Approval; me: string; busy: boolean; run: Run }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState("");
  const mine = approval.requestedBy.id === me;

  useEffect(() => {
    if (!approval.policy) return;
    api<Diff>(`/admin/franchise/policies/${approval.policy.id}/diff`).then((r) => r.ok && setDiff(r.data));
    api<SchemaResponse>("/admin/franchise/policies/schema").then((r) => r.ok && setFields(r.data.fields[approval.policy!.domain] ?? []));
  }, [approval.policy]);

  return (
    <div className="rounded-lg border border-border-strong p-4 text-sm">
      <p className="font-medium text-parchment">
        {DOMAIN_LABEL[approval.policy?.domain ?? ""] ?? approval.policy?.domain} v{approval.policy?.version} — requested by {approval.requestedBy.name} on {formatDateTime(approval.createdAt)}
      </p>
      <p className="mt-1 text-xs text-parchment-muted">Reason: {approval.reason}</p>
      <p className="mt-1 text-xs text-parchment-muted">
        Takes effect: {approval.payload.effectiveFrom ? formatDateTime(approval.payload.effectiveFrom) : "on approval"} · expires {formatDateTime(approval.expiresAt)}
      </p>
      <p className="mt-1 text-xs text-parchment-muted">
        Payload hash: <span className="font-mono [overflow-wrap:anywhere]">{approval.payloadSha256}</span>
      </p>
      <div className="mt-2">
        <DiffList diff={diff} fields={fields} />
      </div>
      {mine ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-parchment-muted">You requested this — a different admin must approve it.</p>
          <input aria-label="Withdrawal note" className="input-field !w-56 text-xs" placeholder="Why withdraw?" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            disabled={busy || note.trim().length < 3}
            onClick={() => run(() => api(`/admin/franchise/approvals/${approval.id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }), "Request withdrawn.")}
            className="btn-outline !px-3 !py-1.5 text-xs"
          >
            Withdraw
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-parchment-muted">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5" />I reviewed every change above. Approving publishes exactly this version (hash {shortSha(approval.payloadSha256)}).
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busy || !reviewed}
              onClick={() => run(() => api(`/admin/franchise/approvals/${approval.id}/approve`, { method: "POST", body: JSON.stringify({ expectedPayloadSha: approval.payloadSha256 }) }), "Approved and published.")}
              className="btn-gold !px-3 !py-1.5 text-xs"
            >
              Approve and publish
            </button>
            <input aria-label="Rejection note" className="input-field !w-56 text-xs" placeholder="Why reject?" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              disabled={busy || note.trim().length < 3}
              onClick={() => run(() => api(`/admin/franchise/approvals/${approval.id}/reject`, { method: "POST", body: JSON.stringify({ note }) }), "Rejected.")}
              className="btn-outline !border-danger !px-3 !py-1.5 text-xs !text-danger"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

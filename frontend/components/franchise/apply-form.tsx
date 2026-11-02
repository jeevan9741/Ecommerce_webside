"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { FranchiseState } from "@/lib/franchise";
import {
  ACCEPT_ATTR,
  checkFile,
  DOCUMENT_FIELDS,
  formatBytes,
  isValidMobile,
  parseInvestment,
  requirementFor,
  type DocumentRequirements,
} from "@/lib/franchise-form";

interface Props {
  email: string;
  defaultName: string;
  states: FranchiseState[];
  requirements: DocumentRequirements;
  refundPolicy: { version: number; text: string; sha256: string };
}

export function FranchiseApplyForm({ email, defaultName, states, requirements, refundPolicy }: Props) {
  const router = useRouter();
  const [stateId, setStateId] = useState("");
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const districts = useMemo(() => states.find((s) => s.id === stateId)?.districts ?? [], [states, stateId]);
  const docs = DOCUMENT_FIELDS.map((d) => ({ ...d, requirement: requirementFor(d.kind, requirements) })).filter((d) => d.requirement !== "NOT_REQUESTED");

  function pickFile(field: string, input: HTMLInputElement) {
    const file = input.files?.[0] ?? null;
    const problem = file ? checkFile(file) : null;
    setError(problem);
    if (problem) input.value = ""; // don't leave a rejected file looking selected
    setFiles((prev) => ({ ...prev, [field]: file && !problem ? file : null }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const mobile = String(form.get("mobile") ?? "");
    if (!isValidMobile(mobile)) return setError("Enter a 10-digit Indian mobile number.");
    const investment = parseInvestment(String(form.get("investmentCapacityInr") ?? ""));
    if (!investment.ok) return setError("Investment capacity must be a whole number of rupees, up to ₹100 crore.");
    for (const d of docs) if (d.requirement === "REQUIRED" && !files[d.field] && !(d.kind === "BUSINESS_PLAN" && String(form.get("businessPlanText") ?? "").trim())) return setError(`${d.label} is required.`);
    if (!acknowledged) return setError("Please read and accept the fee refund policy.");

    const body = new FormData();
    for (const key of ["applicantName", "stateId", "districtId", "address", "education", "businessExperience", "officeAvailable", "businessPlanText"]) body.set(key, String(form.get(key) ?? ""));
    body.set("mobile", mobile.trim());
    body.set("investmentCapacityInr", investment.value ?? "");
    body.set("refundPolicyVersion", String(refundPolicy.version));
    body.set("refundPolicySha256", refundPolicy.sha256);
    for (const d of docs) {
      const f = files[d.field];
      if (f) body.set(d.field, f, f.name);
    }
    setBusy(true);
    try {
      await api.post("/franchise/applications", body);
      router.push("/franchise/application?submitted=1");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "POLICY_CHANGED") setError("The refund policy was just updated. Reload the page to review the new version.");
      else setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-6 p-6 sm:p-8" noValidate>
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-parchment">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="applicantName">Full name</label>
            <input id="applicantName" name="applicantName" required minLength={2} maxLength={100} defaultValue={defaultName} className="input-field" />
          </div>
          <div>
            <label className="label-field" htmlFor="mobile">Mobile number</label>
            <input id="mobile" name="mobile" required inputMode="numeric" maxLength={10} className="input-field" placeholder="9876543210" />
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="email">Email</label>
          <input id="email" value={email} readOnly className="input-field opacity-70" aria-describedby="email-note" />
          <p id="email-note" className="mt-1 text-xs text-parchment-muted">Your verified account email. We&apos;ll send updates here.</p>
        </div>
        <div>
          <label className="label-field" htmlFor="address">Full address</label>
          <textarea id="address" name="address" required minLength={10} maxLength={500} rows={3} className="input-field resize-none" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-parchment">District</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="stateId">State / Union Territory</label>
            <select id="stateId" name="stateId" required value={stateId} onChange={(e) => setStateId(e.target.value)} className="input-field">
              <option value="">Choose…</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field" htmlFor="districtId">District</label>
            <select id="districtId" name="districtId" required disabled={!stateId} className="input-field" key={stateId}>
              <option value="">{stateId ? "Choose…" : "Choose a state first"}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.available}>
                  {d.name}{d.available ? "" : " — already taken"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-parchment-muted">Applying doesn&apos;t reserve the district or guarantee that it will be allocated to you.</p>
        {states.length === 0 && <p className="text-sm text-parchment-muted">No districts are listed yet.</p>}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-parchment">Background</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="education">Education (optional)</label>
            <input id="education" name="education" maxLength={100} className="input-field" />
          </div>
          <div>
            <label className="label-field" htmlFor="investmentCapacityInr">Investment capacity in ₹ (optional)</label>
            <input id="investmentCapacityInr" name="investmentCapacityInr" inputMode="numeric" className="input-field" placeholder="5,00,000" />
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="businessExperience">Business experience (optional)</label>
          <textarea id="businessExperience" name="businessExperience" maxLength={2000} rows={3} className="input-field resize-none" />
        </div>
        <div>
          <label className="label-field" htmlFor="officeAvailable">Do you have an office or training space?</label>
          <select id="officeAvailable" name="officeAvailable" className="input-field" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="true">Yes</option>
            <option value="false">Not yet</option>
          </select>
        </div>
        {requirementFor("BUSINESS_PLAN", requirements) !== "NOT_REQUESTED" && (
          <div>
            <label className="label-field" htmlFor="businessPlanText">Business plan summary {requirementFor("BUSINESS_PLAN", requirements) === "REQUIRED" ? "(or upload it below)" : "(optional)"}</label>
            <textarea id="businessPlanText" name="businessPlanText" maxLength={5000} rows={4} className="input-field resize-none" />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-parchment">Documents</h2>
        <p className="text-xs text-parchment-muted">PDF, JPEG or PNG, up to 5 MB each. Documents are stored privately.</p>
        {docs.map((d) => (
          <div key={d.field}>
            <label className="label-field" htmlFor={d.field}>
              {d.label} {d.requirement === "OPTIONAL" && <span className="text-parchment-muted">(optional)</span>}
            </label>
            <input
              id={d.field}
              type="file"
              accept={ACCEPT_ATTR}
              onChange={(e) => pickFile(d.field, e.currentTarget)}
              className="input-field file:mr-4 file:rounded-full file:border-0 file:bg-gold-500 file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
            />
            {files[d.field] && <p className="mt-1 text-xs text-parchment-muted">{files[d.field]!.name} · {formatBytes(files[d.field]!.size)}</p>}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-parchment">Fee refund policy (version {refundPolicy.version})</h2>
        <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-lg border border-white/10 p-4 text-sm leading-relaxed text-parchment-muted">{refundPolicy.text}</div>
        <label className="flex items-start gap-3 text-sm text-parchment">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1" />
          I have read the fee refund policy above.
        </label>
      </section>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn-gold w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit application"}
      </button>
    </form>
  );
}

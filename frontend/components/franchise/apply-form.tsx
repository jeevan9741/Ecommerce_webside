"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { PolicyText } from "@/components/franchise/policy-text";
import { DEMO_DISTRICTS_NOTICE } from "@/lib/franchise-landing";
import { STATE_CLOSED_MESSAGE, STATE_RESERVED_MESSAGE, type FranchiseState } from "@/lib/franchise";
import {
  ACCEPT_ATTR,
  APPLICATION_STEPS,
  applicationStepProblem,
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
  privacyNotice: { version: number; text: string; sha256: string };
  /** Demonstration (unverified) district data: say so, and never call a district available. */
  demoDistricts?: boolean;
}

/**
 * The franchise application in three steps. Every field stays mounted (hidden steps are only hidden),
 * so the final submission is the same single request the backend has always validated; the step checks
 * just surface mistakes earlier.
 */
export function FranchiseApplyForm({ email, defaultName, states, requirements, privacyNotice, demoDistricts = false }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [stateId, setStateId] = useState("");
  const [files, setFiles] = useState<Record<string, File | null>>({});
  // Unticked by default; the server checks it again.
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = useMemo(() => states.find((s) => s.id === stateId), [states, stateId]);
  const districts = chosen?.availability === "AVAILABLE" ? chosen.districts : [];
  const docs = DOCUMENT_FIELDS.map((d) => ({ ...d, requirement: requirementFor(d.kind, requirements) })).filter((d) => d.requirement !== "NOT_REQUESTED");
  const last = APPLICATION_STEPS.length - 1;

  function values() {
    const form = new FormData(formRef.current ?? undefined);
    const get = (k: string) => String(form.get(k) ?? "");
    return { applicantName: get("applicantName"), mobile: get("mobile"), stateId: get("stateId"), districtId: get("districtId"), address: get("address"), investmentCapacityInr: get("investmentCapacityInr") };
  }

  function goTo(next: number) {
    // Moving forward checks every step being left; going back never blocks.
    for (let s = step; s < next; s++) {
      const problem = applicationStepProblem(s, values());
      if (problem) {
        setStep(s);
        setError(problem);
        return;
      }
    }
    setError(null);
    setStep(next);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pickFile(field: string, input: HTMLInputElement) {
    const file = input.files?.[0] ?? null;
    const problem = file ? checkFile(file) : null;
    setError(problem);
    if (problem) input.value = ""; // don't leave a rejected file looking selected
    setFiles((prev) => ({ ...prev, [field]: file && !problem ? file : null }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < last) return goTo(step + 1); // Enter in an earlier step moves on instead of submitting
    setError(null);
    for (let s = 0; s < last; s++) {
      const problem = applicationStepProblem(s, values());
      if (problem) {
        setStep(s);
        return setError(problem);
      }
    }
    const form = new FormData(e.currentTarget);
    const mobile = String(form.get("mobile") ?? "");
    if (!isValidMobile(mobile)) return setError("Enter a 10-digit Indian mobile number.");
    const investment = parseInvestment(String(form.get("investmentCapacityInr") ?? ""));
    if (!investment.ok) return setError("Investment capacity must be a whole number of rupees, up to ₹100 crore.");
    for (const d of docs) if (d.requirement === "REQUIRED" && !files[d.field] && !(d.kind === "BUSINESS_PLAN" && String(form.get("businessPlanText") ?? "").trim())) return setError(`${d.label} is required.`);
    if (!privacyAccepted) return setError("Please read and accept the privacy notice.");

    const body = new FormData();
    for (const key of ["applicantName", "stateId", "districtId", "address", "education", "businessExperience", "officeAvailable", "businessPlanText"]) body.set(key, String(form.get(key) ?? ""));
    body.set("mobile", mobile.trim());
    body.set("investmentCapacityInr", investment.value ?? "");
    body.set("privacyNoticeAccepted", privacyAccepted ? "true" : "false");
    body.set("privacyNoticeVersion", String(privacyNotice.version));
    body.set("privacyNoticeSha256", privacyNotice.sha256);
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
      if (err instanceof ApiError && err.data.code === "POLICY_CHANGED") setError("The programme terms were just updated. Reload the page and try again.");
      else if (err instanceof ApiError && err.data.code === "STATE_CLOSED") setError(STATE_CLOSED_MESSAGE);
      else if (err instanceof ApiError && err.data.code === "STATE_RESERVED") setError(STATE_RESERVED_MESSAGE);
      else if (err instanceof ApiError && err.data.code === "PRIVACY_NOTICE_CHANGED") setError("The privacy notice was just updated. Reload the page to read and accept the new version.");
      else if (err instanceof ApiError && err.data.code === "PRIVACY_NOTICE_NOT_ACCEPTED") setError("Please read and accept the privacy notice.");
      else setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card scroll-mt-24 space-y-6 p-6 sm:p-8" noValidate aria-describedby="step-status">
      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Application steps">
        {APPLICATION_STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => i !== step && goTo(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                i === step ? "border-gold-500 bg-gold-500/10 text-parchment" : "border-white/10 text-parchment-muted hover:border-white/20"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < step ? "bg-emerald text-white" : i === step ? "bg-gold-500 text-ink" : "border border-white/20"}`}
                aria-hidden="true"
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span>
                <span className="block text-xs uppercase tracking-wide text-parchment-muted">Step {i + 1}</span>
                {label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p id="step-status" className="sr-only" aria-live="polite">
        Step {step + 1} of {APPLICATION_STEPS.length}: {APPLICATION_STEPS[step]}
      </p>

      {/* Step 1: applicant details */}
      <section className="space-y-4" hidden={step !== 0}>
        <h2 className="font-display text-lg font-semibold text-parchment">Applicant details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="applicantName">Full name</label>
            <input id="applicantName" name="applicantName" required minLength={2} maxLength={100} defaultValue={defaultName} autoComplete="name" className="input-field" />
          </div>
          <div>
            <label className="label-field" htmlFor="mobile">Mobile number</label>
            <input id="mobile" name="mobile" required inputMode="numeric" maxLength={10} autoComplete="tel-national" className="input-field" placeholder="9876543210" />
          </div>
        </div>
        <div>
          <label className="label-field" htmlFor="email">Email</label>
          <input id="email" value={email} readOnly className="input-field opacity-70" aria-describedby="email-note" />
          <p id="email-note" className="mt-1 text-xs text-parchment-muted">Your verified account email. We&apos;ll send updates here.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label-field" htmlFor="stateId">State / Union Territory</label>
            <select id="stateId" name="stateId" required value={stateId} onChange={(e) => setStateId(e.target.value)} className="input-field">
              <option value="">Choose…</option>
              {states.map((s) => (
                <option key={s.id} value={s.id} disabled={s.availability !== "AVAILABLE"}>
                  {s.name}{s.availability === "CLOSED" ? " — franchise active" : s.availability === "RESERVED" ? " — reserved" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field" htmlFor="districtId">Training centre district</label>
            <select id="districtId" name="districtId" required disabled={!stateId || districts.length === 0} className="input-field" key={stateId} aria-describedby="district-note">
              <option value="">{stateId ? "Choose…" : "Choose a state first"}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.available}>
                  {d.name}{demoDistricts ? " (demo)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        {demoDistricts && (
          <p role="note" className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-3 text-sm font-semibold text-parchment">
            {DEMO_DISTRICTS_NOTICE}
          </p>
        )}
        {chosen && chosen.availability !== "AVAILABLE" && (
          <p role="alert" className="text-sm text-danger">{chosen.availability === "CLOSED" ? STATE_CLOSED_MESSAGE : STATE_RESERVED_MESSAGE}</p>
        )}
        <p id="district-note" className="text-xs text-parchment-muted">
          The franchise covers the whole state; the district is where your training centre will be. Applying doesn&apos;t reserve the state or
          guarantee that it will be allocated to you.
        </p>
        {states.length === 0 && <p className="text-sm text-parchment-muted">No states are listed yet.</p>}
        <div>
          <label className="label-field" htmlFor="address">Full address</label>
          <textarea id="address" name="address" required minLength={10} maxLength={500} rows={3} autoComplete="street-address" className="input-field resize-none" />
        </div>
      </section>

      {/* Step 2: business details */}
      <section className="space-y-4" hidden={step !== 1}>
        <h2 className="font-display text-lg font-semibold text-parchment">Business details</h2>
        <div>
          <label className="label-field" htmlFor="businessExperience">Business experience (optional)</label>
          <textarea id="businessExperience" name="businessExperience" maxLength={2000} rows={3} className="input-field resize-none" />
        </div>
        <div>
          <label className="label-field" htmlFor="officeAvailable">Proposed training centre: do you have an office or training space?</label>
          <select id="officeAvailable" name="officeAvailable" className="input-field" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="true">Yes</option>
            <option value="false">Not yet</option>
          </select>
        </div>
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
        {requirementFor("BUSINESS_PLAN", requirements) !== "NOT_REQUESTED" && (
          <div>
            <label className="label-field" htmlFor="businessPlanText">
              Business plan summary {requirementFor("BUSINESS_PLAN", requirements) === "REQUIRED" ? "(or upload it in step 3)" : "(optional)"}
            </label>
            <textarea id="businessPlanText" name="businessPlanText" maxLength={5000} rows={4} className="input-field resize-none" />
          </div>
        )}
      </section>

      {/* Step 3: documents and confirmation */}
      <section className="space-y-6" hidden={step !== 2}>
        <div className="space-y-4">
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
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-parchment">Privacy notice</h2>
          <p className="text-xs text-parchment-muted">Please read the full notice before you accept it. It explains how your application information is handled.</p>
          <PolicyText title="Privacy notice" version={privacyNotice.version} text={privacyNotice.text} scroll />
          <label className="flex items-start gap-3 text-sm text-parchment">
            <input type="checkbox" checked={privacyAccepted} onChange={(e) => setPrivacyAccepted(e.target.checked)} className="mt-1" aria-describedby="privacy-accept-note" />
            <span>I have read the privacy notice above (version {privacyNotice.version}) and accept it.</span>
          </label>
          <p id="privacy-accept-note" className="text-xs text-parchment-muted">We record the version you accept and the time you submit.</p>
        </div>
      </section>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {step > 0 ? (
          <button type="button" onClick={() => goTo(step - 1)} className="btn-outline" disabled={busy}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < last ? (
          <button type="button" onClick={() => goTo(step + 1)} className="btn-gold">
            Continue to {APPLICATION_STEPS[step + 1].toLowerCase()}
          </button>
        ) : (
          <button type="submit" disabled={busy} className="btn-gold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Submitting" /> : "Submit application"}
          </button>
        )}
      </div>
    </form>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { DOCUMENT_KIND_LABEL, formatBytes, formatRupees } from "@/lib/franchise-form";
import { ACTION, REJECTION_REASON_MAX, isReviewAction, rejectionReasonError, type ReviewAction } from "@/lib/franchise-review";
import { StatusBadge } from "@/components/franchise/status-badge";

interface Detail {
  id: string;
  applicationNo: string;
  status: string;
  statusLabel: string;
  version: number;
  submittedAt: string;
  applicant: { name: string; email: string; mobile: string; address: string; emailVerified: boolean; accountCreatedAt: string };
  location: { state: string; district: string; districtCode: string | null };
  answers: { education: string | null; businessExperience: string | null; officeAvailable: boolean | null; investmentCapacityInr: number | null; businessPlanText: string | null };
  refundPolicy: { version: number };
  requiredDocumentKinds: string[];
  documents: { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  decision: { approvedAt: string | null; approvedBy: string | null; rejectedAt: string | null; rejectionReason: string | null };
  history: { id: string; fromLabel: string | null; toLabel: string; toStatus: string; actorName: string | null; applicantNote: string | null; internalNote: string | null; createdAt: string }[];
  notes: { id: string; body: string; author: string | null; createdAt: string }[];
  allowedTransitions: string[];
  district: { districtActive: boolean; held: boolean; approvedApplicationNo: string | null };
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
const fetchDetail = (id: string) => api.get<{ application: Detail }>(`/admin/franchise/applications/${encodeURIComponent(id)}`).then((r) => r.application);

export default function FranchiseApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setApp(await fetchDetail(id));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [id]);
  useEffect(() => {
    fetchDetail(id).then(setApp, (err) => setError(message(err)));
  }, [id]);

  if (!app) {
    return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="flex items-center gap-2 text-sm text-parchment-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/franchise-applications" className="inline-flex items-center gap-1 text-sm text-parchment-muted hover:text-parchment"><ArrowLeft className="h-4 w-4" /> All applications</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-parchment">{app.applicationNo}</h1>
        <StatusBadge status={app.status} label={app.statusLabel} />
        <span className="text-xs text-parchment-muted">Submitted {formatDateTime(app.submittedAt)} · {app.location.district}, {app.location.state}</span>
      </div>
      {notice && <p role="status" className="rounded-lg border border-emerald/40 p-3 text-sm text-emerald">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">Applicant</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Name" value={app.applicant.name} />
              <Item label="Mobile" value={app.applicant.mobile} />
              <Item label="Email" value={`${app.applicant.email}${app.applicant.emailVerified ? " (verified)" : " (not verified)"}`} />
              <Item label="Account created" value={formatDateTime(app.applicant.accountCreatedAt)} />
              <Item label="Address" value={app.applicant.address} wide />
              <Item label="District" value={`${app.location.district}${app.location.districtCode ? ` (LGD ${app.location.districtCode})` : ""}, ${app.location.state}`} wide />
            </dl>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">Answers</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Education" value={app.answers.education} />
              <Item label="Investment capacity" value={app.answers.investmentCapacityInr !== null ? formatRupees(app.answers.investmentCapacityInr) : null} />
              <Item label="Office or training space" value={app.answers.officeAvailable === null ? null : app.answers.officeAvailable ? "Yes" : "Not yet"} />
              <Item label="Refund policy accepted" value={`Version ${app.refundPolicy.version}`} />
              <Item label="Business experience" value={app.answers.businessExperience} wide />
              <Item label="Business plan" value={app.answers.businessPlanText} wide />
            </dl>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">Documents</h2>
            <p className="mt-1 text-xs text-parchment-muted">Opening documents arrives with the document-review phase; only the list is shown here.</p>
            <ul className="mt-3 divide-y divide-white/5 text-sm">
              {app.documents.map((d) => (
                <li key={d.id} className="py-2">
                  <span className="text-parchment">{DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}</span>
                  <span className="text-xs text-parchment-muted"> · {d.originalName} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.createdAt)}</span>
                </li>
              ))}
              {app.documents.length === 0 && <li className="py-2 text-parchment-muted">No documents.</li>}
            </ul>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">History</h2>
            <ol className="mt-4 space-y-4 text-sm">
              {app.history.map((h) => (
                <li key={h.id} className="border-l-2 border-white/10 pl-3">
                  <p className="text-parchment">{h.fromLabel ? `${h.fromLabel} → ` : ""}{h.toLabel}</p>
                  <p className="text-xs text-parchment-muted">{formatDateTime(h.createdAt)} · {h.actorName ?? "System"}</p>
                  {h.applicantNote && <p className="mt-1 text-xs text-parchment-muted">To applicant: {h.applicantNote}</p>}
                  {h.internalNote && <p className="mt-1 text-xs text-gold-400">Internal: {h.internalNote}</p>}
                </li>
              ))}
            </ol>
            {app.decision.rejectionReason && <p className="mt-4 text-sm text-parchment-muted">Reason shown to the applicant: <span className="text-parchment">{app.decision.rejectionReason}</span></p>}
          </section>
        </div>

        <div className="space-y-6">
          <Actions app={app} onDone={async (msg) => { setNotice(msg); await reload(); }} />
          <Notes app={app} onAdded={reload} />
        </div>
      </div>
    </div>
  );
}

function Actions({ app, onDone }: { app: Detail; onDone: (msg: string) => Promise<void> }) {
  const [pending, setPending] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const [applicantNote, setApplicantNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = app.allowedTransitions.filter(isReviewAction);
  const districtBlock = !app.district.districtActive ? "This district is disabled." : app.district.held ? "This district is already held by a franchise." : app.district.approvedApplicationNo ? `Application ${app.district.approvedApplicationNo} for this district is already approved.` : null;

  const start = (a: ReviewAction) => {
    setPending(a);
    setReason("");
    setApplicantNote("");
    setInternalNote("");
    setError(null);
  };
  async function confirm() {
    if (!pending) return;
    if (pending === "REJECTED") {
      const problem = rejectionReasonError(reason);
      if (problem) return setError(problem);
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/franchise/applications/${encodeURIComponent(app.id)}/transition`, {
        to: pending,
        expectedVersion: app.version,
        ...(applicantNote.trim() ? { applicantNote: applicantNote.trim() } : {}),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
        ...(pending === "REJECTED" ? { rejectionReason: reason.trim() } : {}),
      });
      setPending(null);
      await onDone(`Done: ${ACTION[pending].label}. The applicant has been emailed.`);
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "STALE") setError("Someone else changed this application. Reload the page to see the latest version.");
      else setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">Decision</h2>
      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-parchment-muted">No review actions are available for this status in this phase.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a} type="button" disabled={busy || (a === "APPROVED" && Boolean(districtBlock))} onClick={() => start(a)} className={ACTION[a].tone === "bad" ? "btn-ghost btn-sm text-danger" : ACTION[a].tone === "good" ? "btn-gold btn-sm" : "btn-outline btn-sm"}>
              {ACTION[a].label}
            </button>
          ))}
        </div>
      )}
      {actions.includes("APPROVED") && districtBlock && (
        <p className="mt-3 flex gap-2 text-xs text-gold-400"><AlertTriangle className="h-4 w-4 shrink-0" /> Approval unavailable: {districtBlock}</p>
      )}
      {app.decision.approvedAt && <p className="mt-3 text-xs text-parchment-muted">Approved {formatDateTime(app.decision.approvedAt)} by {app.decision.approvedBy}. No district has been reserved or allocated yet.</p>}

      {pending && (
        <div className="mt-4 space-y-3 rounded-lg border border-white/10 p-4" role="dialog" aria-label={ACTION[pending].label}>
          <p className="text-sm text-parchment">{ACTION[pending].confirm}</p>
          {pending === "REJECTED" && (
            <div>
              <label htmlFor="reason" className="label-field">Reason (shown to the applicant after sign-in)</label>
              <textarea id="reason" rows={4} maxLength={REJECTION_REASON_MAX} className="input-field resize-none text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="mt-1 text-xs text-parchment-muted">{reason.trim().length}/{REJECTION_REASON_MAX} · at least 10 characters</p>
            </div>
          )}
          {pending !== "REJECTED" && (
            <div>
              <label htmlFor="applicant-note" className="label-field">Note to the applicant (optional)</label>
              <textarea id="applicant-note" rows={2} maxLength={500} className="input-field resize-none text-sm" value={applicantNote} onChange={(e) => setApplicantNote(e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="internal-note" className="label-field">Internal note (admins only, optional)</label>
            <textarea id="internal-note" rows={2} maxLength={2000} className="input-field resize-none text-sm" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={confirm} className={pending === "REJECTED" ? "btn-outline btn-sm text-danger" : "btn-gold btn-sm"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Confirm: ${ACTION[pending].label}`}
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} className="btn-ghost btn-sm">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Notes({ app, onAdded }: { app: Detail; onAdded: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/franchise/applications/${encodeURIComponent(app.id)}/notes`, { body: body.trim() });
      setBody("");
      await onAdded();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">Internal notes</h2>
      <p className="mt-1 text-xs text-parchment-muted">Admins only. Notes can&apos;t be edited or deleted.</p>
      <ul className="mt-3 space-y-3 text-sm">
        {app.notes.map((n) => (
          <li key={n.id}>
            <p className="whitespace-pre-line text-parchment">{n.body}</p>
            <p className="text-xs text-parchment-muted">{n.author ?? "Unknown"} · {formatDateTime(n.createdAt)}</p>
          </li>
        ))}
        {app.notes.length === 0 && <li className="text-parchment-muted">No notes yet.</li>}
      </ul>
      <form onSubmit={add} className="mt-4 space-y-2">
        <label htmlFor="note" className="sr-only">New note</label>
        <textarea id="note" rows={3} maxLength={2000} className="input-field resize-none text-sm" placeholder="Add a note for other admins" value={body} onChange={(e) => setBody(e.target.value)} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || !body.trim()} className="btn-outline btn-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add note"}</button>
      </form>
    </section>
  );
}

function Item({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-parchment-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-line text-parchment">{value || "—"}</dd>
    </div>
  );
}

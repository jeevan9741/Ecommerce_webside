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
import { AdminUnavailableSystems } from "@/components/franchise/admin-unavailable-systems";

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
  /** Only on applications submitted while a refund acknowledgement was still collected. */
  refundPolicy: { version: number } | null;
  requiredDocumentKinds: string[];
  documents: { id: string; kind: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  decision: { approvedAt: string | null; approvedBy: string | null; rejectedAt: string | null; rejectionReason: string | null };
  history: { id: string; fromLabel: string | null; toLabel: string; toStatus: string; actorName: string | null; applicantNote: string | null; internalNote: string | null; createdAt: string }[];
  notes: { id: string; body: string; author: string | null; createdAt: string }[];
  allowedTransitions: string[];
  /** One primary franchise per state: whether this application's state is free for it. */
  territory: { locationActive: boolean; held: boolean; heldStatus: string | null; reservedForThis: boolean; approvedApplicationNo: string | null };
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
              <Item label="State (franchise territory)" value={app.location.state} />
              <Item label="Training centre district" value={`${app.location.district}${app.location.districtCode ? ` (LGD ${app.location.districtCode})` : ""}`} />
            </dl>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-parchment">Answers</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Education" value={app.answers.education} />
              <Item label="Investment capacity" value={app.answers.investmentCapacityInr !== null ? formatRupees(app.answers.investmentCapacityInr) : null} />
              <Item label="Office or training space" value={app.answers.officeAvailable === null ? null : app.answers.officeAvailable ? "Yes" : "Not yet"} />
              {app.refundPolicy && <Item label="Refund policy acknowledged (earlier form)" value={`Version ${app.refundPolicy.version}`} />}
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
          <StateReservation app={app} onDone={async (msg) => { setNotice(msg); await reload(); }} />
          <AdminUnavailableSystems note="Approval never activates a franchise; activation needs all of these." />
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
  const t = app.territory;
  const districtBlock = !t.locationActive
    ? "This state or centre district is disabled."
    : t.held
      ? t.heldStatus === "RESERVED" ? "This state is reserved for another application." : "This state already has an active ETA franchise."
      : t.approvedApplicationNo ? `Application ${t.approvedApplicationNo} for this state is already approved.` : null;

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
      {app.decision.approvedAt && <p className="mt-3 text-xs text-parchment-muted">Approved {formatDateTime(app.decision.approvedAt)} by {app.decision.approvedBy}. Approval doesn&apos;t reserve or close the state.</p>}

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

/** Statuses at which an admin may temporarily reserve the state (mirrors the backend's rule). */
const RESERVABLE = ["APPROVED", "PAYMENT_PENDING", "AGREEMENT_PENDING"];

function StateReservation({ app, onDone }: { app: Detail; onDone: (msg: string) => Promise<void> }) {
  const [mode, setMode] = useState<"reserve" | "release" | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = app.territory;
  const canReserve = RESERVABLE.includes(app.status) && !t.held && !t.reservedForThis && t.locationActive;

  async function confirm() {
    if (!mode) return;
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters; it is recorded in the audit log.");
    setBusy(true);
    setError(null);
    try {
      const path = `/admin/franchise/applications/${encodeURIComponent(app.id)}/${mode === "reserve" ? "reserve-state" : "release-reservation"}`;
      await api.post(path, mode === "reserve" ? { reason: reason.trim(), days: Number(days) } : { reason: reason.trim() });
      setMode(null);
      setReason("");
      await onDone(mode === "reserve" ? `State reserved for ${app.applicationNo}.` : "Reservation released; the state is available again.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">State: {app.location.state}</h2>
      <p className="mt-1 text-xs text-parchment-muted">
        {t.reservedForThis
          ? "Temporarily reserved for this application. Other applicants can't apply for this state while it lasts."
          : t.held
            ? t.heldStatus === "RESERVED" ? "Reserved for another application." : "This state already has an active ETA franchise."
            : "Available. Applications alone never close a state."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canReserve && (
          <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => { setMode("reserve"); setError(null); }}>
            Reserve state
          </button>
        )}
        {t.reservedForThis && (
          <button type="button" className="btn-ghost btn-sm text-danger" disabled={busy} onClick={() => { setMode("release"); setError(null); }}>
            Release reservation
          </button>
        )}
        <button type="button" className="btn-gold btn-sm" disabled aria-describedby="activate-note">
          Activate franchise
        </button>
      </div>
      <p id="activate-note" className="mt-2 text-xs text-parchment-muted">
        Activation is not available yet: fee payment verification and the signed franchise agreement aren&apos;t set up. Activation will
        require both, plus a reservation, before the state closes.
      </p>
      {mode && (
        <div className="mt-4 space-y-3 rounded-lg border border-white/10 p-4" role="dialog" aria-label={mode === "reserve" ? "Reserve state" : "Release reservation"}>
          <label className="label-field" htmlFor="reservation-reason">Reason (recorded in the audit log)</label>
          <textarea id="reservation-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="input-field resize-none" />
          {mode === "reserve" && (
            <div>
              <label className="label-field" htmlFor="reservation-days">Reserve for (days, up to 90)</label>
              <input id="reservation-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="input-field w-32" />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-gold btn-sm" disabled={busy} onClick={confirm}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "Confirm"}
            </button>
            <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

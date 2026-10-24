"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Award, BadgeCheck, Download, Loader2, Plus, RotateCcw, Search, ShieldAlert, Trash2, UploadCloud } from "lucide-react";
import { ToastStack, useToasts } from "@/components/toast";
import { adminService } from "@/services/adminService";
import { formatCertificateDate } from "@/lib/certificate/design";
import { normaliseCertificateNo } from "@/lib/certificate/verify";
import {
  certificateFileUrl,
  certificateService,
  type AdminCertificate,
  type AdminCertificateDetail,
  type CourseType,
  type Signatory,
} from "@/services/certificateService";

type Push = (type: "success" | "error", message: string) => void;

function errorText(err: unknown, fallback = "Something went wrong.") {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Course completion certificates: verify by ID, issue certificates for Zoom / offline centre /
 * e-book courses, revoke or restore, and set who signs them.
 */
export default function AdminCourseCertificatesPage() {
  const { toasts, push, dismiss } = useToasts();
  const [list, setList] = useState<AdminCertificate[] | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    async (q = "") => {
      try {
        setList((await certificateService.adminList(q)).certificates);
      } catch (err) {
        push("error", errorText(err, "Could not load certificates."));
        setList((l) => l ?? []);
      }
    },
    [push]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Course Certificates</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Video course certificates are issued automatically when a student completes every lesson (one language is
          enough). Zoom, offline centre and e-book course certificates are issued here.
        </p>
      </div>

      <VerifyPanel push={push} onChanged={() => void load(query)} />

      <div className="grid gap-6 xl:grid-cols-2">
        <IssuePanel push={push} onIssued={() => void load(query)} />
        <SignatoryPanel push={push} />
      </div>

      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg font-semibold text-parchment">Issued certificates</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(query);
            }}
            className="flex gap-2"
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, student, email or course" className="input-field !py-2 sm:w-72" />
            <button type="submit" className="btn-outline btn-sm">
              <Search className="h-4 w-4" />
            </button>
          </form>
        </div>
        {!list ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
          </div>
        ) : list.length === 0 ? (
          <p className="card mt-4 p-6 text-center text-sm text-parchment-muted">No certificates{query ? " match your search" : " issued yet"}.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-parchment-muted">
                <tr className="border-b border-border-soft">
                  <th className="px-4 py-3">Certificate ID</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-border-soft last:border-0">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-parchment">{c.certificateNo}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-parchment">{c.studentName}</p>
                      <p className="text-xs text-parchment-muted">{c.email}</p>
                    </td>
                    <td className="px-4 py-3 text-parchment">{c.courseTitle}</td>
                    <td className="px-4 py-3 text-parchment-muted">{formatCertificateDate(c.completedAt)}</td>
                    <td className="px-4 py-3 text-xs text-parchment-muted">{c.issuedBy === "auto" ? "On completion" : "By admin"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function StatusBadge({ status }: { status: "VALID" | "REVOKED" }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
        status === "VALID" ? "border-emerald/30 bg-emerald/10 text-emerald" : "border-danger/30 bg-danger/10 text-danger"
      }`}
    >
      {status === "VALID" ? "Valid" : "Revoked"}
    </span>
  );
}

/** Look a certificate up by its ID, and revoke or restore it. */
function VerifyPanel({ push, onChanged }: { push: Push; onChanged: () => void }) {
  const [id, setId] = useState("");
  const [result, setResult] = useState<AdminCertificateDetail | "missing" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function verify(certificateNo: string) {
    setBusy(true);
    try {
      setResult((await certificateService.adminGet(certificateNo)).certificate);
    } catch {
      setResult("missing");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: AdminCertificateDetail) {
    if (c.status === "VALID" && reason.trim().length < 3) return push("error", "Give a reason for revoking.");
    setBusy(true);
    try {
      if (c.status === "VALID") await certificateService.adminRevoke(c.id, reason.trim());
      else await certificateService.adminRestore(c.id);
      push("success", c.status === "VALID" ? "Certificate revoked." : "Certificate restored.");
      setReason("");
      onChanged();
      await verify(c.certificateNo);
    } catch (err) {
      push("error", errorText(err));
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold text-parchment">
        <BadgeCheck className="h-5 w-5 text-gold-500" /> Verify a certificate
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const no = normaliseCertificateNo(id);
          if (no) void verify(no);
        }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ECA-2026-K7Q3XM" aria-label="Certificate ID" className="input-field font-mono uppercase sm:max-w-sm" />
        <button type="submit" disabled={busy} className="btn-gold btn-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Verify
        </button>
      </form>

      {result === "missing" && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">
          <ShieldAlert className="h-4 w-4" /> No certificate with this ID — it was not issued by the academy.
        </p>
      )}
      {result && result !== "missing" && (
        <div className="mt-4 rounded-xl border border-border-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-sm font-bold text-parchment">{result.certificateNo}</p>
            <StatusBadge status={result.status} />
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["Student (on certificate)", result.studentName],
              ["Account", `${result.student.name} · ${result.student.email}${result.student.phone ? ` · ${result.student.phone}` : ""}`],
              ["Course", `${result.courseTitle} (${result.courseType})`],
              ["Completed on", formatCertificateDate(result.completedAt)],
              ["Issued", `${formatCertificateDate(result.issuedAt)} · ${result.issuedBy === "auto" ? "automatically on completion" : "by an admin"}`],
              ...(result.currentProgress
                ? [["Current progress", `${result.currentProgress.completedLessons} of ${result.currentProgress.totalLessons} lessons (${result.currentProgress.percent}%) · ${result.lessonCount} at issue`]]
                : []),
              ...(result.revokedAt ? [["Revoked", `${formatCertificateDate(result.revokedAt)} — ${result.revokedReason ?? ""}`]] : []),
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{term}</dt>
                <dd className="text-parchment">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            {result.status === "VALID" && (
              <>
                <a href={certificateFileUrl(result.certificateNo, "certificate.pdf")} className="btn-outline btn-sm">
                  <Download className="h-4 w-4" /> PDF
                </a>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for revoking" maxLength={300} className="input-field !py-2 sm:flex-1" />
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggle(result)}
              className={result.status === "VALID" ? "btn-outline btn-sm !border-danger !text-danger hover:!bg-danger hover:!text-white" : "btn-outline btn-sm"}
            >
              {result.status === "VALID" ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              {result.status === "VALID" ? "Revoke" : "Restore"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface CourseOption {
  id: string;
  title: string;
  type: CourseType;
}

/** Issue a certificate for a Zoom, offline centre or e-book course. */
function IssuePanel({ push, onIssued }: { push: Push; onIssued: () => void }) {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [email, setEmail] = useState("");
  const [courseId, setCourseId] = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminService
      .courses()
      .then(({ courses: all }) => setCourses((all as CourseOption[]).filter((c) => c.type !== "VIDEO")))
      .catch(() => setCourses([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!courseId) return push("error", "Choose a course.");
    setBusy(true);
    try {
      const { certificate } = await certificateService.adminIssue({ email: email.trim(), courseId, completedAt });
      push("success", `Issued ${certificate.certificateNo} to ${certificate.studentName}.`);
      setEmail("");
      onIssued();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold text-parchment">
        <Award className="h-5 w-5 text-gold-500" /> Issue a certificate
      </h2>
      <p className="mt-1 text-xs text-parchment-muted">For Zoom, offline centre and e-book courses. The student must have purchased the course.</p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block">
          <span className="label-field">Student email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
        </label>
        <label className="block">
          <span className="label-field">Course</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="input-field" required>
            <option value="" disabled>
              Choose a course…
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.type})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label-field">Completion date</span>
          <input type="date" required value={completedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCompletedAt(e.target.value)} className="input-field" />
        </label>
        <button type="submit" disabled={busy} className="btn-gold btn-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Issue certificate
        </button>
      </form>
    </section>
  );
}

const MAX_SIGNATURE_BYTES = 500 * 1024;

/** Who signs the certificates. The signature image is optional (a blank line prints without it). */
function SignatoryPanel({ push }: { push: Push }) {
  const [signatory, setSignatory] = useState<Signatory | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [signature, setSignature] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    certificateService
      .settings()
      .then(({ signatory: s }) => {
        setSignatory(s);
        setName(s.name);
        setTitle(s.title);
      })
      .catch((err) => push("error", errorText(err, "Could not load the signatory.")));
  }, [push]);

  function pick(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return push("error", "Use a PNG or JPEG image (a transparent PNG looks best).");
    if (file.size > MAX_SIGNATURE_BYTES) return push("error", "The signature image must be 500 KB or smaller.");
    const reader = new FileReader();
    reader.onload = () => setSignature(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { signatory: saved } = await certificateService.saveSettings({ name: name.trim(), title: title.trim(), ...(signature !== undefined ? { signature } : {}) });
      setSignatory(saved);
      setSignature(undefined);
      push("success", "Signatory saved. New downloads use it straight away.");
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const preview = signature === undefined ? signatory?.signatureUrl ?? null : signature;
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold text-parchment">
        <BadgeCheck className="h-5 w-5 text-gold-500" /> Signatory
      </h2>
      {!signatory ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gold-500" />
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label-field">Name</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="input-field" />
            </label>
            <label className="block">
              <span className="label-field">Title</span>
              <input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="input-field" />
            </label>
          </div>
          <div>
            <span className="label-field">Signature image</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-20 w-56 items-center justify-center rounded-xl border border-dashed border-border-soft bg-white">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed Blob URL / local data URL
                  <img src={preview} alt="Signature" className="max-h-16 max-w-52 object-contain" />
                ) : (
                  <span className="text-xs text-parchment-muted">No signature yet</span>
                )}
              </div>
              <label className="btn-outline btn-sm cursor-pointer">
                <UploadCloud className="h-4 w-4" /> Upload
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              </label>
              {preview && (
                <button type="button" onClick={() => setSignature(null)} className="btn-ghost btn-sm">
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-parchment-muted">PNG with a transparent background, up to 500 KB. Without one, certificates show a blank signature line.</p>
          </div>
          <button type="submit" disabled={busy} className="btn-gold btn-sm">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save signatory
          </button>
        </form>
      )}
    </section>
  );
}

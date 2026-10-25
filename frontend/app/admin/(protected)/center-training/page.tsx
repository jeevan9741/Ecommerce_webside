"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Lock } from "lucide-react";
import { backendFetch } from "@/lib/api";
import { formatInr } from "@/lib/format";
import { CENTRE_FIELDS, centreForm, centrePatch, type CentreField, type CentreForm } from "@/lib/centre-details";
import { CentreDetails } from "@/components/learning/centre-details";
import { useToasts, ToastStack } from "@/components/toast";

interface CentreCourse {
  id: string;
  slug: string;
  type: string;
  title: string;
  priceInPaise: number;
  isActive: boolean;
  metadata: unknown;
}

interface EnrolmentSummary {
  orders: Partial<Record<"CREATED" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED", number>>;
  access: { active: number; revoked: number };
}

const FIELD_META: Record<CentreField, { label: string; hint?: string; placeholder: string; multiline?: boolean }> = {
  address: { label: "Center address", placeholder: "Street, town, district, state, PIN", multiline: true },
  mapUrl: { label: "Map link", hint: "An https:// link, e.g. from Google Maps → Share.", placeholder: "https://maps.app.goo.gl/…" },
  dates: { label: "Batch dates", placeholder: "e.g. 10–12 November 2026" },
  schedule: { label: "Schedule", placeholder: "e.g. Day 1–3: 9:00 AM – 6:00 PM, lunch 1–2 PM", multiline: true },
  inclusions: { label: "What's included", hint: "One item per line.", placeholder: "Accommodation\nMeals\nStudy material", multiline: true },
  notes: { label: "Additional notes", hint: "Optional. Hidden from students when empty.", placeholder: "e.g. Bring a photo ID", multiline: true },
};

const ORDER_LABELS: [keyof EnrolmentSummary["orders"], string][] = [
  ["PAID", "Paid orders"],
  ["CREATED", "Unpaid (checkout started)"],
  ["FAILED", "Failed"],
  ["CANCELLED", "Cancelled"],
  ["REFUNDED", "Refunded"],
];

async function fetchCentreCourses() {
  const res = await backendFetch("/api/admin/courses");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not load packages.");
  return (data.courses as CentreCourse[]).filter((c) => c.type === "CENTRE");
}

/**
 * Configures the existing offline centre (CENTRE) package: venue and batch details shown to buyers,
 * price and status. Saves through the admin course PATCH, which merges metadata — nothing here
 * creates a package or touches orders and access.
 */
export default function AdminCenterTrainingPage() {
  const [courses, setCourses] = useState<CentreCourse[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const load = useCallback(
    () =>
      fetchCentreCourses()
        .then((centre) => {
          setCourses(centre);
          setSelectedId((current) => (current && centre.some((c) => c.id === current) ? current : (centre[0]?.id ?? null)));
        })
        .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load packages.")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const course = courses?.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Center Training</h1>
          <p className="mt-1 text-sm text-parchment-muted">Venue, batch details, price and status of the offline center package.</p>
        </div>
        {courses && courses.length > 1 && (
          <select className="input-field !w-auto" value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {loadError ? (
        <p className="mt-6 text-sm text-danger">{loadError}</p>
      ) : !courses ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
        </div>
      ) : !course ? (
        <div className="card mt-6 p-6 text-sm text-parchment-muted">
          No offline center package exists yet. Add one on the{" "}
          <Link href="/admin/courses" className="text-gold-500 hover:underline">
            Courses
          </Link>{" "}
          page with the type “3-Day Academy Centre Course”, then configure it here.
        </div>
      ) : (
        <CentreEditor key={course.id} course={course} onSaved={load} push={push} />
      )}
    </div>
  );
}

function CentreEditor({
  course,
  onSaved,
  push,
}: {
  course: CentreCourse;
  onSaved: () => Promise<void>;
  push: (type: "success" | "error", message: string) => void;
}) {
  const [form, setForm] = useState<CentreForm>(() => centreForm(course.metadata));
  const [price, setPrice] = useState(String(course.priceInPaise / 100));
  const [isActive, setIsActive] = useState(course.isActive);
  const [summary, setSummary] = useState<EnrolmentSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backendFetch(`/api/admin/courses/${course.id}/enrolment-summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [course.id]);

  const priceInPaise = Math.round(Number(price) * 100);
  const priceValid = price.trim() !== "" && Number.isFinite(priceInPaise) && priceInPaise > 0;
  const priceChanged = priceValid && priceInPaise !== course.priceInPaise;

  async function save() {
    if (!priceValid) {
      setError("Enter a price greater than ₹0.");
      return;
    }
    setSaving(true);
    setError(null);
    // Price and status are sent only when changed; centre details are always sent in full.
    const body = {
      ...(priceChanged ? { priceInPaise } : {}),
      ...(isActive !== course.isActive ? { isActive } : {}),
      metadata: centrePatch(form),
    };
    try {
      const res = await backendFetch(`/api/admin/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the center details.");
      push("success", "Center training details saved.");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the center details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        <section className="card p-6">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-gold-500" />
            <h2 className="font-semibold text-parchment">{course.title}</h2>
          </div>
          <p className="mt-1 text-xs text-parchment-muted">{course.slug}</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field" htmlFor="centre-price">
                Price (₹)
              </label>
              <input id="centre-price" type="number" min="1" step="1" className="input-field" value={price} onChange={(e) => setPrice(e.target.value)} />
              <p className="mt-1 text-xs text-parchment-muted">Current: {formatInr(course.priceInPaise)}</p>
            </div>
            <label className="flex items-center gap-2 self-center text-sm text-parchment-muted">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (visible to customers)
            </label>
          </div>
          {priceChanged && (
            <p className="mt-3 rounded-lg border border-gold-500/40 px-3 py-2 text-xs text-parchment">
              New checkouts will be charged {formatInr(priceInPaise)}. Existing orders keep the amount they were placed at.
            </p>
          )}
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="font-semibold text-parchment">Center details</h2>
          <p className="text-xs text-parchment-muted">Shown to students who bought this package. Empty fields show “Details will be announced soon.”</p>
          {CENTRE_FIELDS.map((field) => {
            const meta = FIELD_META[field];
            const id = `centre-${field}`;
            const props = {
              id,
              className: `input-field ${meta.multiline ? "min-h-20" : ""}`,
              value: form[field],
              placeholder: meta.placeholder,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value }),
            };
            return (
              <div key={field}>
                <label className="label-field" htmlFor={id}>
                  {meta.label}
                </label>
                {meta.multiline ? <textarea {...props} /> : <input type={field === "mapUrl" ? "url" : "text"} {...props} />}
                {meta.hint && <p className="mt-1 text-xs text-parchment-muted">{meta.hint}</p>}
              </div>
            );
          })}

          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={save} disabled={saving} className="btn-gold w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save center details"}
          </button>
        </section>
      </div>

      <div className="space-y-6">
        <section className="card p-6">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-parchment-muted" />
            <h2 className="font-semibold text-parchment">Orders &amp; access</h2>
          </div>
          <p className="mt-1 text-xs text-parchment-muted">Read-only. Manage individual orders on the Orders page.</p>
          {!summary ? (
            <Loader2 className="mt-4 h-5 w-5 animate-spin text-gold-500" />
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {ORDER_LABELS.map(([status, label]) => (
                <div key={status} className="rounded-lg border border-border-strong px-3 py-2">
                  <dt className="text-xs text-parchment-muted">{label}</dt>
                  <dd className="text-lg font-semibold text-parchment">{summary.orders[status] ?? 0}</dd>
                </div>
              ))}
              <div className="rounded-lg border border-border-strong px-3 py-2">
                <dt className="text-xs text-parchment-muted">Students with access</dt>
                <dd className="text-lg font-semibold text-parchment">{summary.access.active}</dd>
              </div>
              <div className="rounded-lg border border-border-strong px-3 py-2">
                <dt className="text-xs text-parchment-muted">Access revoked</dt>
                <dd className="text-lg font-semibold text-parchment">{summary.access.revoked}</dd>
              </div>
            </dl>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-parchment">Student preview</h2>
          <p className="mt-1 text-xs text-parchment-muted">How the course page will look with the details above (before saving).</p>
          <CentreDetails metadata={centrePatch(form)} />
        </section>
      </div>
    </div>
  );
}

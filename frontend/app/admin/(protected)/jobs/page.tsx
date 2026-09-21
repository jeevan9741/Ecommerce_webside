"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Pencil, Trash2, Users } from "lucide-react";
import { Modal } from "@/components/admin/modal";

type WorkType = "WORK_FROM_HOME" | "OFFICE" | "HYBRID";

interface JobPosting {
  id: string;
  title: string;
  description: string;
  eligibility: string;
  salary: string;
  workType: WorkType;
  workingHours: string;
  isActive: boolean;
  _count: { applications: number };
}

const WORK_TYPE_LABEL: Record<WorkType, string> = {
  WORK_FROM_HOME: "Work From Home",
  OFFICE: "Office",
  HYBRID: "Hybrid",
};

const emptyForm = {
  title: "",
  description: "",
  eligibility: "",
  salary: "",
  workType: "OFFICE" as WorkType,
  workingHours: "",
  isActive: true,
};

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<JobPosting[] | null>(null);
  const [modal, setModal] = useState<JobPosting | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await backendFetch("/api/admin/jobs").then((r) => r.json());
    setJobs(data.jobs);
  }

  useEffect(() => {
    backendFetch("/api/admin/jobs")
      .then((r) => r.json())
      .then((data) => setJobs(data.jobs));
  }, []);

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setModal("new");
  }

  function openEdit(job: JobPosting) {
    setForm({
      title: job.title,
      description: job.description,
      eligibility: job.eligibility,
      salary: job.salary,
      workType: job.workType,
      workingHours: job.workingHours,
      isActive: job.isActive,
    });
    setError(null);
    setModal(job);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const isNew = modal === "new";
    const res = await backendFetch(isNew ? "/api/admin/jobs" : `/api/admin/jobs/${(modal as JobPosting).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save job posting");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModal(null);
    await load();
  }

  async function toggleActive(job: JobPosting) {
    if (job.isActive) {
      await backendFetch(`/api/admin/jobs/${job.id}`, { method: "DELETE" });
    } else {
      await backendFetch(`/api/admin/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
    }
    await load();
  }

  if (!jobs) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-parchment">Job Postings</h1>
          <p className="mt-1 text-sm text-parchment-muted">{jobs.length} postings</p>
        </div>
        <button onClick={openNew} className="btn-gold !px-4 !py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add Job Posting
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {jobs.map((j) => (
          <div key={j.id} className="card flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium text-parchment">{j.title}</p>
              <p className="text-xs text-parchment-muted">
                {WORK_TYPE_LABEL[j.workType]} · {j.salary} · {j.workingHours}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  j.isActive ? "border-emerald/40 text-emerald" : "border-border-strong text-parchment-muted"
                }`}
              >
                {j.isActive ? "Active" : "Inactive"}
              </span>
              <Link href={`/admin/jobs/${j.id}/applications`} className="btn-outline !px-3 !py-1.5 text-xs">
                <Users className="h-3.5 w-3.5" /> {j._count.applications} Applications
              </Link>
              <button onClick={() => openEdit(j)} className="btn-ghost !px-2 !py-1.5" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => toggleActive(j)}
                className="btn-ghost !px-2 !py-1.5 !text-danger"
                title={j.isActive ? "Deactivate" : "Activate"}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {jobs.length === 0 && <p className="card p-8 text-center text-sm text-parchment-muted">No job postings yet.</p>}
      </div>

      {modal && (
        <Modal title={modal === "new" ? "Add Job Posting" : "Edit Job Posting"} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="label-field">Title</label>
              <input className="input-field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label-field">Description</label>
              <textarea
                className="input-field min-h-24"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Eligibility / Requirements</label>
              <textarea
                className="input-field min-h-20"
                value={form.eligibility}
                onChange={(e) => setForm({ ...form, eligibility: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-field">Salary</label>
                <input
                  className="input-field"
                  placeholder="₹15,000 – ₹25,000 / month"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                />
              </div>
              <div>
                <label className="label-field">Working Hours</label>
                <input
                  className="input-field"
                  placeholder="10 AM – 6 PM, Mon–Sat"
                  value={form.workingHours}
                  onChange={(e) => setForm({ ...form, workingHours: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label-field">Work Type</label>
              <select
                className="input-field"
                value={form.workType}
                onChange={(e) => setForm({ ...form, workType: e.target.value as WorkType })}
              >
                {Object.entries(WORK_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-parchment-muted">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active (visible on Careers page)
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Job Posting"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

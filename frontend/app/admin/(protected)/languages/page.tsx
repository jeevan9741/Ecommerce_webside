"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Modal } from "@/components/admin/modal";

interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
  displayOrder: number;
  _count: { courseVideos: number };
}

const emptyForm = { code: "", name: "", nativeName: "", displayOrder: 0 };

export default function AdminLanguagesPage() {
  const [languages, setLanguages] = useState<Language[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await backendFetch("/api/admin/languages").then((r) => r.json());
    setLanguages(data.languages);
  }

  useEffect(() => {
    backendFetch("/api/admin/languages")
      .then((r) => r.json())
      .then((data) => setLanguages(data.languages));
  }, []);

  async function toggleActive(lang: Language) {
    await backendFetch(`/api/admin/languages/${lang.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !lang.isActive }),
    });
    await load();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await backendFetch("/api/admin/languages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to add language");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModalOpen(false);
    setForm(emptyForm);
    await load();
  }

  if (!languages) {
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
          <h1 className="font-display text-2xl font-semibold text-parchment">Languages</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            {languages.length} languages configured · supports future expansion beyond the initial 23
          </p>
        </div>
        <button
          onClick={() => {
            setForm(emptyForm);
            setError(null);
            setModalOpen(true);
          }}
          className="btn-gold !px-4 !py-2.5 text-sm"
        >
          <Plus className="h-4 w-4" /> Add Language
        </button>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[700px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-parchment-muted">
              <th className="px-4 pb-2">Language</th>
              <th className="px-4 pb-2">Code</th>
              <th className="px-4 pb-2">Native Name</th>
              <th className="px-4 pb-2">Courses Using</th>
              <th className="px-4 pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {languages.map((l) => (
              <tr key={l.id} className="card">
                <td className="rounded-l-2xl px-4 py-3 text-parchment">{l.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gold-400">{l.code}</td>
                <td className="px-4 py-3 text-parchment-muted">{l.nativeName}</td>
                <td className="px-4 py-3 text-parchment-muted">{l._count.courseVideos}</td>
                <td className="rounded-r-2xl px-4 py-3">
                  <button
                    onClick={() => toggleActive(l)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      l.isActive ? "border-emerald/40 text-emerald" : "border-border-strong text-parchment-muted"
                    }`}
                  >
                    {l.isActive ? "Active" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Add Language" onClose={() => setModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="label-field">Language Code</label>
              <input
                className="input-field"
                placeholder="e.g. hi, en, brx"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Name (English)</label>
              <input
                className="input-field"
                placeholder="e.g. Hindi"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Native Name</label>
              <input
                className="input-field"
                placeholder="e.g. हिन्दी"
                value={form.nativeName}
                onChange={(e) => setForm({ ...form, nativeName: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Display Order</label>
              <input
                type="number"
                className="input-field"
                value={form.displayOrder}
                onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving || !form.code || !form.name || !form.nativeName} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Language"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

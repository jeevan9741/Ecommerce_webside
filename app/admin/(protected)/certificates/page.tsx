"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, FileText } from "lucide-react";
import { Modal } from "@/components/admin/modal";
import { FileUploadField } from "@/components/admin/file-upload-field";

interface Certificate {
  id: string;
  title: string;
  description: string | null;
  storageKey: string;
  displayOrder: number;
}

export default function AdminCertificatesPage() {
  const [certificates, setCertificates] = useState<Certificate[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await fetch("/api/admin/certificates").then((r) => r.json());
    setCertificates(data.certificates);
  }

  useEffect(() => {
    fetch("/api/admin/certificates")
      .then((r) => r.json())
      .then((data) => setCertificates(data.certificates));
  }, []);

  function openNew() {
    setTitle("");
    setDescription("");
    setPendingKey(null);
    setError(null);
    setModalOpen(true);
  }

  async function save() {
    if (!pendingKey) {
      setError("Please upload a document first.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        storageKey: pendingKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save certificate");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModalOpen(false);
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/admin/certificates/${id}`, { method: "DELETE" });
    await load();
  }

  if (!certificates) {
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
          <h1 className="font-display text-2xl font-semibold text-parchment">Certificates &amp; Legal Documents</h1>
          <p className="mt-1 text-sm text-parchment-muted">
            Shown publicly on the About page for transparency ({certificates.length} documents)
          </p>
        </div>
        <button onClick={openNew} className="btn-gold !px-4 !py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add Document
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {certificates.map((c) => (
          <div key={c.id} className="card flex items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 shrink-0 text-gold-500" />
              <div>
                <p className="text-sm font-semibold text-parchment">{c.title}</p>
                {c.description && <p className="text-xs text-parchment-muted">{c.description}</p>}
              </div>
            </div>
            <button onClick={() => remove(c.id)} className="btn-ghost !px-2 !py-1.5 !text-danger" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {certificates.length === 0 && (
          <p className="card col-span-2 p-8 text-center text-sm text-parchment-muted">No documents uploaded yet.</p>
        )}
      </div>

      {modalOpen && (
        <Modal title="Add Certificate / Document" onClose={() => setModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="label-field">Title</label>
              <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GST Registration Certificate" />
            </div>
            <div>
              <label className="label-field">Description (optional)</label>
              <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="label-field">Document File (PDF/Image)</label>
              <FileUploadField prefix="certificates" accept="application/pdf,image/*" onUploaded={(key) => setPendingKey(key)} />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving || !title.trim()} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Document"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

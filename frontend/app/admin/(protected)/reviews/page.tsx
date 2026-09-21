"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Star } from "lucide-react";
import { Modal } from "@/components/admin/modal";

interface Review {
  id: string;
  customerName: string;
  rating: number;
  text: string;
  isApproved: boolean;
  displayOrder: number;
}

const emptyForm = {
  customerName: "",
  rating: 5,
  text: "",
  isApproved: true,
  displayOrder: 0,
};

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [modal, setModal] = useState<Review | "new" | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await backendFetch("/api/admin/reviews").then((r) => r.json());
    setReviews(data.reviews);
  }

  useEffect(() => {
    backendFetch("/api/admin/reviews")
      .then((r) => r.json())
      .then((data) => setReviews(data.reviews));
  }, []);

  function openNew() {
    setForm(emptyForm);
    setError(null);
    setModal("new");
  }

  function openEdit(review: Review) {
    setForm({
      customerName: review.customerName,
      rating: review.rating,
      text: review.text,
      isApproved: review.isApproved,
      displayOrder: review.displayOrder,
    });
    setError(null);
    setModal(review);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const isNew = modal === "new";
    const res = await backendFetch(isNew ? "/api/admin/reviews" : `/api/admin/reviews/${(modal as Review).id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save review");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModal(null);
    await load();
  }

  async function toggleApproved(review: Review) {
    await backendFetch(`/api/admin/reviews/${review.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isApproved: !review.isApproved }),
    });
    await load();
  }

  async function remove(id: string) {
    await backendFetch(`/api/admin/reviews/${id}`, { method: "DELETE" });
    await load();
  }

  if (!reviews) {
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
          <h1 className="font-display text-2xl font-semibold text-parchment">Customer Reviews</h1>
          <p className="mt-1 text-sm text-parchment-muted">{reviews.length} reviews</p>
        </div>
        <button onClick={openNew} className="btn-gold !px-4 !py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Add Review
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-parchment">{r.customerName}</p>
                <span className="flex items-center text-gold-500">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-current" />
                  ))}
                </span>
              </div>
              <p className="mt-1 max-w-xl text-sm text-parchment-muted">{r.text}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleApproved(r)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  r.isApproved ? "border-emerald/40 text-emerald" : "border-border-strong text-parchment-muted"
                }`}
              >
                {r.isApproved ? "Approved" : "Hidden"}
              </button>
              <button onClick={() => openEdit(r)} className="btn-ghost !px-2 !py-1.5" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={() => remove(r.id)} className="btn-ghost !px-2 !py-1.5 !text-danger" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {reviews.length === 0 && <p className="card p-8 text-center text-sm text-parchment-muted">No reviews yet.</p>}
      </div>

      {modal && (
        <Modal title={modal === "new" ? "Add Review" : "Edit Review"} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="label-field">Customer Name</label>
              <input
                className="input-field"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </div>
            <div>
              <label className="label-field">Rating</label>
              <select
                className="input-field"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} Star{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Review Text</label>
              <textarea className="input-field min-h-24" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
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
            <label className="flex items-center gap-2 text-sm text-parchment-muted">
              <input
                type="checkbox"
                checked={form.isApproved}
                onChange={(e) => setForm({ ...form, isApproved: e.target.checked })}
              />
              Approved (visible on Home page)
            </label>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button onClick={save} disabled={saving} className="btn-gold w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Review"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

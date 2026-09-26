"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  categoryService,
  formatRupees,
  type AdminCategory,
  type AdminSubcategory,
  type PackageOption,
} from "@/services/categoryService";
import { CategoryTile } from "@/components/library/category-theme";
import { errorText, type Push } from "@/components/admin/video-shared";

/**
 * Category manager: the topic tree (categories → subcategories), which packages unlock each
 * category, ordering, visibility, and adding/removing entries. Videos are filed into these from
 * the Course videos tab.
 */
export function CategoryManager({
  categories,
  packages,
  reload,
  push,
}: {
  categories: AdminCategory[] | null;
  packages: PackageOption[];
  reload: () => Promise<void>;
  push: Push;
}) {
  const [adding, setAdding] = useState(false);

  if (!categories) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-parchment-muted">
          Students see these categories in their Course Library. Tick the packages that unlock each category — buyers of
          any ticked package can watch every video in it and its subcategories. Unticked categories stay locked.
        </p>
        <button type="button" onClick={() => setAdding(true)} className="btn-gold btn-sm self-start">
          <Plus className="h-4 w-4" /> Add category
        </button>
      </div>

      {adding && (
        <NameForm
          className="card mt-4 p-4"
          placeholder="Category name, e.g. WhatsApp Marketing"
          submitLabel="Add category"
          onCancel={() => setAdding(false)}
          onSubmit={async (name) => {
            await categoryService.create({ name });
            setAdding(false);
            await reload();
            push("success", `Added “${name}”.`);
          }}
          push={push}
        />
      )}

      <div className="mt-5 space-y-4">
        {categories.map((c, i) => (
          <CategoryCard
            key={c.id}
            category={c}
            packages={packages}
            first={i === 0}
            last={i === categories.length - 1}
            reload={reload}
            push={push}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryCard({
  category: c,
  packages,
  first,
  last,
  reload,
  push,
}: {
  category: AdminCategory;
  packages: PackageOption[];
  first: boolean;
  last: boolean;
  reload: () => Promise<void>;
  push: Push;
}) {
  const [addingSub, setAddingSub] = useState(false);
  const [savingPackages, setSavingPackages] = useState(false);

  async function togglePackage(id: string) {
    const next = c.packageIds.includes(id) ? c.packageIds.filter((p) => p !== id) : [...c.packageIds, id];
    setSavingPackages(true);
    try {
      await categoryService.setPackages(c.id, next);
      await reload();
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setSavingPackages(false);
    }
  }

  return (
    <div className={`card overflow-hidden ${c.isActive ? "" : "opacity-70"}`}>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <CategoryTile slug={c.slug} />
        <EntryRow entry={c} first={first} last={last} reload={reload} push={push} />
      </div>

      <div className="border-t border-border-soft px-4 py-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-parchment-muted">
          Unlocked by {savingPackages && <Loader2 className="h-3 w-3 animate-spin" />}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {packages.map((p) => {
            const on = c.packageIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={savingPackages}
                onClick={() => togglePackage(p.id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  on ? "border-emerald bg-emerald/10 text-emerald" : "border-border-soft text-parchment-muted hover:border-gold-500/50"
                }`}
              >
                {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {p.title} · {formatRupees(p.priceInPaise)}
                {!p.isActive && " (inactive)"}
              </button>
            );
          })}
        </div>
        {c.packageIds.length === 0 && <p className="mt-2 text-xs text-amber-600">No package unlocks this category yet — students see it as “Coming soon”.</p>}
      </div>

      <div className="border-t border-border-soft bg-surface-hover/40 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">Subcategories</p>
        {c.subcategories.length === 0 && !addingSub && (
          <p className="mt-2 text-xs text-parchment-muted">None — videos are filed directly in {c.name}.</p>
        )}
        <div className="mt-2 space-y-2">
          {c.subcategories.map((s, i) => (
            <div key={s.id} className={`rounded-xl border border-border-soft bg-surface px-3 py-2 ${s.isActive ? "" : "opacity-70"}`}>
              <EntryRow entry={s} first={i === 0} last={i === c.subcategories.length - 1} reload={reload} push={push} compact />
            </div>
          ))}
        </div>
        {addingSub ? (
          <NameForm
            className="mt-2"
            placeholder={`Subcategory name, e.g. ${c.name} Ads`}
            submitLabel="Add subcategory"
            onCancel={() => setAddingSub(false)}
            onSubmit={async (name) => {
              await categoryService.create({ name, parentId: c.id });
              setAddingSub(false);
              await reload();
              push("success", `Added “${name}” to ${c.name}.`);
            }}
            push={push}
          />
        ) : (
          <button type="button" onClick={() => setAddingSub(true)} className="btn-ghost btn-sm mt-2">
            <Plus className="h-4 w-4" /> Add subcategory
          </button>
        )}
      </div>
    </div>
  );
}

/** Name, counts and the rename / show-hide / reorder / delete controls for a category or subcategory. */
function EntryRow({
  entry,
  first,
  last,
  reload,
  push,
  compact,
}: {
  entry: AdminSubcategory;
  first: boolean;
  last: boolean;
  reload: () => Promise<void>;
  push: Push;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      await reload();
      if (success) push("success", success);
    } catch (err) {
      push("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <NameForm
        className="min-w-0 flex-1"
        initial={entry.name}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={async (name) => {
          await categoryService.update(entry.id, { name });
          setEditing(false);
          await reload();
        }}
        push={push}
      />
    );
  }

  const hidden = entry.publishedCount !== entry.videoCount ? ` (${entry.videoCount - entry.publishedCount} hidden)` : "";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className={`font-semibold text-parchment ${compact ? "text-sm" : ""}`}>
          {entry.name}
          {!entry.isActive && (
            <span className="ml-2 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Hidden
            </span>
          )}
        </p>
        <p className="text-xs text-parchment-muted">
          {entry.publishedCount} published {entry.publishedCount === 1 ? "video" : "videos"}
          {hidden}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <IconButton label="Move up" disabled={busy || first} onClick={() => run(() => categoryService.move(entry.id, "up"))}>
          <ArrowUp className="h-4 w-4" />
        </IconButton>
        <IconButton label="Move down" disabled={busy || last} onClick={() => run(() => categoryService.move(entry.id, "down"))}>
          <ArrowDown className="h-4 w-4" />
        </IconButton>
        <IconButton label="Rename" disabled={busy} onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={entry.isActive ? "Hide from students" : "Show to students"}
          disabled={busy}
          onClick={() =>
            run(() => categoryService.update(entry.id, { isActive: !entry.isActive }), entry.isActive ? `${entry.name} is hidden.` : `${entry.name} is visible.`)
          }
        >
          {entry.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              setTimeout(() => setConfirmDelete(false), 5000);
              return;
            }
            void run(() => categoryService.remove(entry.id), `Deleted “${entry.name}”.`);
          }}
          className="btn-ghost btn-sm !px-2 !text-danger"
          title="Delete (only when empty)"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {confirmDelete && <span className="text-xs">Confirm</span>}
        </button>
      </div>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-ghost btn-sm !px-2 disabled:opacity-30" title={label} aria-label={label}>
      {children}
    </button>
  );
}

function NameForm({
  initial = "",
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  push,
  className = "",
}: {
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  push: Push;
  className?: string;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (value.length < 2) return push("error", "Enter a name.");
    setSaving(true);
    try {
      await onSubmit(value);
    } catch (err) {
      push("error", errorText(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-2 sm:flex-row ${className}`}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={80} className="input-field !py-2 flex-1" autoFocus />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-gold btn-sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost btn-sm" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

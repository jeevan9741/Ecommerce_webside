"use client";

import { backendFetch } from "@/lib/api";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, Pencil, Phone, Save, User, X, Globe2 } from "lucide-react";
import { LanguageSelector, type LanguageOption } from "@/components/language-selector";
import { useToasts, ToastStack } from "@/components/toast";

interface ProfileValues {
  name: string;
  phone: string;
  languageCode: string;
}

export function ProfileForm({
  initialName,
  initialPhone,
  initialLanguageCode,
  languages,
  email,
  username,
  memberSince,
}: {
  initialName: string;
  initialPhone: string;
  initialLanguageCode: string;
  languages: LanguageOption[];
  email: string;
  username: string;
  memberSince: string;
}) {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();

  const [saved, setSaved] = useState<ProfileValues>({
    name: initialName,
    phone: initialPhone,
    languageCode: initialLanguageCode,
  });
  const [draft, setDraft] = useState<ProfileValues>(saved);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedLanguage = languages.find((l) => l.code === saved.languageCode);

  function startEditing() {
    setDraft(saved);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(saved);
    setEditing(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    const phone = draft.phone.trim();

    if (name.length < 2) {
      push("error", "Please enter your full name (at least 2 characters).");
      return;
    }
    if (phone.length < 10 || phone.length > 15) {
      push("error", "Please enter a valid mobile number (10–15 digits).");
      return;
    }

    setBusy(true);
    const res = await backendFetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, preferredLanguageCode: draft.languageCode || null }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      push("error", data.error ?? "Could not save your profile. Please try again.");
      return;
    }

    setSaved({ name, phone, languageCode: draft.languageCode });
    setEditing(false);
    push("success", "Profile updated successfully.");
    // Keeps the server-rendered greeting elsewhere on the page in sync with the new name.
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border-soft p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 text-xl font-bold text-white shadow-md">
            {saved.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-parchment">{saved.name}</p>
            <p className="truncate text-sm text-parchment-muted">Member since {memberSince}</p>
          </div>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="btn-outline shrink-0 !px-5 !py-2.5 text-sm"
          >
            <Pencil className="h-4 w-4" />
            Edit Profile
          </button>
        )}
      </div>

      {/* Fields */}
      <div className="grid gap-5 p-6 sm:grid-cols-2">
        <FieldShell label="Full Name" icon={User}>
          {editing ? (
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              disabled={busy}
              className="input-field transition disabled:opacity-60"
              placeholder="Your full name"
            />
          ) : (
            <ReadOnlyValue value={saved.name} />
          )}
        </FieldShell>

        <FieldShell label="Mobile Number" icon={Phone}>
          {editing ? (
            <input
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              disabled={busy}
              inputMode="tel"
              className="input-field transition disabled:opacity-60"
              placeholder="10-digit mobile number"
            />
          ) : (
            <ReadOnlyValue value={saved.phone || "Not added yet"} muted={!saved.phone} />
          )}
        </FieldShell>

        <FieldShell label="Email" icon={Mail} locked>
          <ReadOnlyValue value={email} />
        </FieldShell>

        <FieldShell label="Username" icon={User} locked>
          <ReadOnlyValue value={username} />
        </FieldShell>

        <div className="sm:col-span-2">
          <FieldShell label="Preferred Learning Language" icon={Globe2}>
            {editing ? (
              <LanguageSelector
                languages={languages}
                value={draft.languageCode}
                onChange={(code) => setDraft({ ...draft, languageCode: code })}
                placeholder="Select your preferred language"
              />
            ) : (
              <ReadOnlyValue
                value={
                  selectedLanguage
                    ? `${selectedLanguage.name}${
                        selectedLanguage.nativeName && selectedLanguage.nativeName !== selectedLanguage.name
                          ? ` · ${selectedLanguage.nativeName}`
                          : ""
                      }`
                    : "Not selected yet"
                }
                muted={!selectedLanguage}
              />
            )}
          </FieldShell>
        </div>
      </div>

      {/* Actions — only in edit mode */}
      {editing && (
        <div className="flex flex-col gap-3 border-t border-border-soft bg-surface-hover/50 p-6 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cancelEditing}
            disabled={busy}
            className="btn-ghost !border !border-border-soft !px-6 !py-2.5 text-sm disabled:opacity-50 sm:order-1"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-gold !px-6 !py-2.5 text-sm sm:order-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </form>
  );
}

function FieldShell({
  label,
  icon: Icon,
  locked = false,
  children,
}: {
  label: string;
  icon: typeof User;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-gold-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{label}</span>
        {locked && <Lock className="h-3 w-3 text-parchment-muted/70" aria-label="Cannot be changed" />}
      </div>
      {children}
    </div>
  );
}

function ReadOnlyValue({ value, muted = false }: { value: string; muted?: boolean }) {
  return (
    <p
      className={`min-h-[3rem] rounded-xl border border-transparent bg-surface-hover/70 px-4 py-3 text-sm transition-colors ${
        muted ? "text-parchment-muted/70" : "text-parchment"
      }`}
    >
      {value}
    </p>
  );
}

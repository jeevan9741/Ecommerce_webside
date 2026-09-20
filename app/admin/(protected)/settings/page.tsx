"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Save, Trash2, Video } from "lucide-react";
import { FileUploadField } from "@/components/admin/file-upload-field";

interface AboutSettings {
  intro: string;
  mission: string;
}
interface FounderSettings {
  name: string;
  bio: string;
}
interface ContactSettings {
  address: string;
  email: string;
  phone: string;
  whatsapp: string;
  telegram: string;
}
interface SocialLinksSettings {
  instagram: string;
  facebook: string;
  youtube: string;
}
interface LegalSettings {
  note: string;
}
interface DemoVideo {
  id: string;
  languageId: string;
  storageKey: string;
  language: { id: string; code: string; name: string; nativeName: string };
}
interface AdminLanguage {
  id: string;
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
}

const DEFAULT_ABOUT: AboutSettings = {
  intro:
    "E-Commerce Training Academy was founded to make practical, honest, results-oriented e-commerce education accessible to anyone.",
  mission:
    "To equip 100,000 Indian entrepreneurs with the skills and confidence to launch and scale a profitable online store.",
};
const DEFAULT_FOUNDER: FounderSettings = {
  name: "",
  bio: "Founded by a team of e-commerce operators with hands-on experience building and scaling online stores.",
};
const DEFAULT_CONTACT: ContactSettings = {
  address: "Rayadurgam, Andhra Pradesh, India",
  email: "support@ecommerceacademy.in",
  phone: "+91 00000 00000",
  whatsapp: "https://wa.me/910000000000",
  telegram: "https://t.me/ecommercetrainingacademy",
};
const DEFAULT_SOCIAL: SocialLinksSettings = { instagram: "", facebook: "", youtube: "" };
const DEFAULT_LEGAL: LegalSettings = { note: "" };

export default function AdminSettingsPage() {
  const [about, setAbout] = useState(DEFAULT_ABOUT);
  const [founder, setFounder] = useState(DEFAULT_FOUNDER);
  const [contact, setContact] = useState(DEFAULT_CONTACT);
  const [social, setSocial] = useState(DEFAULT_SOCIAL);
  const [legal, setLegal] = useState(DEFAULT_LEGAL);
  const [videos, setVideos] = useState<DemoVideo[] | null>(null);
  const [languages, setLanguages] = useState<AdminLanguage[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [settingsData, videosData, languagesData] = await Promise.all([
        fetch("/api/admin/settings").then((r) => r.json()),
        fetch("/api/admin/demo-videos").then((r) => r.json()),
        fetch("/api/admin/languages").then((r) => r.json()),
      ]);
      const map: Record<string, unknown> = {};
      for (const s of settingsData.settings ?? []) map[s.key] = s.value;
      if (map.about) setAbout({ ...DEFAULT_ABOUT, ...(map.about as object) });
      if (map.founder) setFounder({ ...DEFAULT_FOUNDER, ...(map.founder as object) });
      if (map.contact) setContact({ ...DEFAULT_CONTACT, ...(map.contact as object) });
      if (map.socialLinks) setSocial({ ...DEFAULT_SOCIAL, ...(map.socialLinks as object) });
      if (map.legal) setLegal({ ...DEFAULT_LEGAL, ...(map.legal as object) });
      setVideos(videosData.videos);
      setLanguages((languagesData.languages ?? []).filter((l: AdminLanguage) => l.isActive));
      setLoading(false);
    }
    load();
  }, []);

  async function saveSetting(key: string, value: unknown) {
    setSavingKey(key);
    setSavedKey(null);
    await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setSavingKey(null);
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
  }

  if (loading || !videos) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-parchment">Site Settings</h1>
        <p className="mt-1 text-sm text-parchment-muted">
          Update website content shown on the Home and About pages — no code changes needed.
        </p>
      </div>

      <SettingSection
        title="About & Mission"
        saving={savingKey === "about"}
        saved={savedKey === "about"}
        onSave={() => saveSetting("about", about)}
      >
        <label className="label-field">Introduction</label>
        <textarea className="input-field min-h-24" value={about.intro} onChange={(e) => setAbout({ ...about, intro: e.target.value })} />
        <label className="label-field mt-3">Mission Statement</label>
        <textarea
          className="input-field min-h-24"
          value={about.mission}
          onChange={(e) => setAbout({ ...about, mission: e.target.value })}
        />
      </SettingSection>

      <SettingSection
        title="Founder Details"
        saving={savingKey === "founder"}
        saved={savedKey === "founder"}
        onSave={() => saveSetting("founder", founder)}
      >
        <label className="label-field">Founder Name</label>
        <input className="input-field" value={founder.name} onChange={(e) => setFounder({ ...founder, name: e.target.value })} />
        <label className="label-field mt-3">Founder Bio</label>
        <textarea className="input-field min-h-20" value={founder.bio} onChange={(e) => setFounder({ ...founder, bio: e.target.value })} />
      </SettingSection>

      <SettingSection
        title="Contact Details"
        saving={savingKey === "contact"}
        saved={savedKey === "contact"}
        onSave={() => saveSetting("contact", contact)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label-field">Address</label>
            <input className="input-field" value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Email</label>
            <input className="input-field" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Phone</label>
            <input className="input-field" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div>
            <label className="label-field">WhatsApp Link</label>
            <input className="input-field" value={contact.whatsapp} onChange={(e) => setContact({ ...contact, whatsapp: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Telegram Link</label>
            <input className="input-field" value={contact.telegram} onChange={(e) => setContact({ ...contact, telegram: e.target.value })} />
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title="Social Media Links"
        saving={savingKey === "socialLinks"}
        saved={savedKey === "socialLinks"}
        onSave={() => saveSetting("socialLinks", social)}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label-field">Instagram</label>
            <input className="input-field" value={social.instagram} onChange={(e) => setSocial({ ...social, instagram: e.target.value })} />
          </div>
          <div>
            <label className="label-field">Facebook</label>
            <input className="input-field" value={social.facebook} onChange={(e) => setSocial({ ...social, facebook: e.target.value })} />
          </div>
          <div>
            <label className="label-field">YouTube</label>
            <input className="input-field" value={social.youtube} onChange={(e) => setSocial({ ...social, youtube: e.target.value })} />
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title="Legal / Registration Note"
        saving={savingKey === "legal"}
        saved={savedKey === "legal"}
        onSave={() => saveSetting("legal", legal)}
      >
        <label className="label-field">Note shown near certificates (e.g. registration number)</label>
        <textarea className="input-field min-h-20" value={legal.note} onChange={(e) => setLegal({ ...legal, note: e.target.value })} />
      </SettingSection>

      <DemoVideosSection videos={videos} languages={languages} onChange={setVideos} />
    </div>
  );
}

function SettingSection({
  title,
  children,
  onSave,
  saving,
  saved,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <div className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">{title}</h2>
      <div className="mt-4 space-y-1">{children}</div>
      <button onClick={onSave} disabled={saving} className="btn-outline mt-4 !px-4 !py-2 text-sm">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved" : "Save Changes"}
      </button>
    </div>
  );
}

function DemoVideosSection({
  videos,
  languages,
  onChange,
}: {
  videos: DemoVideo[];
  languages: AdminLanguage[];
  onChange: (videos: DemoVideo[]) => void;
}) {
  const [languageId, setLanguageId] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function togglePreview(v: DemoVideo) {
    if (previewId === v.id) {
      setPreviewId(null);
      setPreviewUrl(null);
      return;
    }
    setPreviewLoading(true);
    const res = await fetch(`/api/demo-videos?lang=${v.language.code}`);
    const data = await res.json();
    setPreviewLoading(false);
    if (res.ok) {
      setPreviewId(v.id);
      setPreviewUrl(data.video.url);
    }
  }

  const availableLanguages = languages.filter((l) => !videos.some((v) => v.languageId === l.id));

  async function add() {
    if (!languageId || !pendingKey) return;
    setBusy(true);
    const res = await fetch("/api/admin/demo-videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languageId, storageKey: pendingKey }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      onChange([...videos.filter((v) => v.languageId !== data.video.languageId), data.video]);
      setLanguageId("");
      setPendingKey(null);
    }
  }

  async function replace(video: DemoVideo, storageKey: string) {
    const res = await fetch("/api/admin/demo-videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ languageId: video.languageId, storageKey }),
    });
    const data = await res.json();
    if (res.ok) {
      onChange([...videos.filter((v) => v.languageId !== data.video.languageId), data.video]);
      setReplacingId(null);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/demo-videos/${id}`, { method: "DELETE" });
    onChange(videos.filter((v) => v.id !== id));
  }

  return (
    <div className="card p-6">
      <h2 className="font-display text-lg font-semibold text-parchment">Demo Videos by Language</h2>
      <p className="mt-1 text-sm text-parchment-muted">
        Shown on the Home page after a visitor selects their preferred language.
      </p>

      <div className="mt-4">
        <select className="input-field" value={languageId} onChange={(e) => setLanguageId(e.target.value)}>
          <option value="">Select a language...</option>
          {availableLanguages.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.nativeName})
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3">
        <FileUploadField prefix="demo-videos" accept="video/*" onUploaded={(key) => setPendingKey(key)} />
      </div>
      <button onClick={add} disabled={busy || !pendingKey || !languageId} className="btn-gold mt-3 !py-2 text-sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Demo Video"}
      </button>

      <div className="mt-5 space-y-2">
        {videos.map((v) => (
          <div key={v.id} className="rounded-xl border border-border-soft px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-parchment">
                <Video className="h-4 w-4 text-gold-500" /> {v.language.name} ({v.language.code})
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => togglePreview(v)} className="btn-ghost !px-2 !py-1 text-xs" title="Preview">
                  {previewLoading && previewId !== v.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : previewId === v.id ? (
                    "Hide"
                  ) : (
                    "Preview"
                  )}
                </button>
                <button
                  onClick={() => setReplacingId(replacingId === v.id ? null : v.id)}
                  className="btn-ghost !px-2 !py-1"
                  title="Replace"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => remove(v.id)} className="btn-ghost !px-2 !py-1 !text-danger" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {previewId === v.id && previewUrl && (
              <video src={previewUrl} controls className="mt-2 w-full rounded-xl border border-border-soft" />
            )}
            {replacingId === v.id && (
              <div className="mt-2">
                <FileUploadField prefix="demo-videos" accept="video/*" onUploaded={(key) => replace(v, key)} />
              </div>
            )}
          </div>
        ))}
        {videos.length === 0 && <p className="text-sm text-parchment-muted">No demo videos uploaded yet.</p>}
      </div>
    </div>
  );
}

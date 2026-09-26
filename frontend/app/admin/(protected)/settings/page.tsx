"use client";

import { backendFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Save, Video } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const settingsData = await backendFetch("/api/admin/settings").then((r) => r.json());
      const map: Record<string, unknown> = {};
      for (const s of settingsData.settings ?? []) map[s.key] = s.value;
      if (map.about) setAbout({ ...DEFAULT_ABOUT, ...(map.about as object) });
      if (map.founder) setFounder({ ...DEFAULT_FOUNDER, ...(map.founder as object) });
      if (map.contact) setContact({ ...DEFAULT_CONTACT, ...(map.contact as object) });
      if (map.socialLinks) setSocial({ ...DEFAULT_SOCIAL, ...(map.socialLinks as object) });
      if (map.legal) setLegal({ ...DEFAULT_LEGAL, ...(map.legal as object) });
      setLoading(false);
    }
    load();
  }, []);

  async function saveSetting(key: string, value: unknown) {
    setSavingKey(key);
    setSavedKey(null);
    await backendFetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setSavingKey(null);
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
  }

  if (loading) {
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

      <div className="card flex flex-wrap items-center justify-between gap-3 p-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-parchment">Demo Videos by Language</h2>
          <p className="mt-1 text-sm text-parchment-muted">Demo and course videos are managed together on the Videos page.</p>
        </div>
        <Link href="/admin/videos?tab=demo" className="btn-outline btn-sm">
          <Video className="h-4 w-4" /> Manage demo videos
        </Link>
      </div>
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

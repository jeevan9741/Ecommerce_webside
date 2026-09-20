import { MapPin, Mail, Phone, MessageCircle, Send, FileText, Download, Target } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getDownloadUrl } from "@/lib/storage";

export const metadata = { title: "About Us" };
export const dynamic = "force-dynamic";

const DEFAULTS = {
  about: {
    intro:
      "E-Commerce Training Academy was founded to make practical, honest, results-oriented e-commerce education accessible to anyone — regardless of their background or the language they're most comfortable learning in. We combine self-paced content, live instruction, and in-person training so every student finds a format that works for them.",
    mission:
      "To equip 100,000 Indian entrepreneurs with the skills and confidence to launch and scale a profitable online store — with clear, no-jargon teaching and real after-purchase support.",
  },
  founder: {
    name: "",
    bio: "Founded by a team of e-commerce operators with hands-on experience building and scaling online stores across multiple marketplaces — now dedicated full-time to teaching what actually works.",
  },
  contact: {
    address: "Rayadurgam, Andhra Pradesh, India",
    email: "support@ecommerceacademy.in",
    phone: "+91 00000 00000",
    whatsapp: "https://wa.me/910000000000",
    telegram: "https://t.me/ecommercetrainingacademy",
  },
  legal: { note: "" },
};

export default async function AboutPage() {
  const [certificates, settings] = await Promise.all([
    prisma.certificate.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.siteSetting.findMany({ where: { key: { in: ["about", "founder", "contact", "legal"] } } }),
  ]);
  const settingsMap: Record<string, unknown> = {};
  for (const s of settings) settingsMap[s.key] = s.value;
  const about = { ...DEFAULTS.about, ...(settingsMap.about as object) };
  const founder = { ...DEFAULTS.founder, ...(settingsMap.founder as object) };
  const contact = { ...DEFAULTS.contact, ...(settingsMap.contact as object) };
  const legal = { ...DEFAULTS.legal, ...(settingsMap.legal as object) };

  const certsWithUrls = await Promise.all(
    certificates.map(async (c) => {
      try {
        return { ...c, url: await getDownloadUrl(c.storageKey, 600) };
      } catch {
        return { ...c, url: null };
      }
    })
  );

  return (
    <div className="container-academy py-16 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="eyebrow">About Us</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-parchment sm:text-5xl">
          Building India&apos;s most <span className="gold-text">trusted</span> e-commerce academy
        </h1>
        <p className="mt-6 text-base leading-relaxed text-parchment-muted">{about.intro}</p>
      </div>

      <div className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-2">
        <div className="card p-8">
          <Target className="h-6 w-6 text-gold-500" />
          <h2 className="mt-4 font-display text-xl font-semibold text-parchment">Our Mission</h2>
          <p className="mt-3 text-sm leading-relaxed text-parchment-muted">{about.mission}</p>
        </div>
        <div className="card p-8">
          <FileText className="h-6 w-6 text-gold-500" />
          <h2 className="mt-4 font-display text-xl font-semibold text-parchment">Founder</h2>
          {founder.name && <p className="mt-1 text-sm font-semibold text-gold-400">{founder.name}</p>}
          <p className="mt-3 text-sm leading-relaxed text-parchment-muted">{founder.bio}</p>
        </div>
      </div>

      {/* Contact */}
      <div className="mx-auto mt-16 max-w-4xl">
        <h2 className="text-center font-display text-2xl font-semibold text-parchment">Get in touch</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ContactTile icon={MapPin} label="Academy Address" value={contact.address} />
          <ContactTile icon={Mail} label="Email" value={contact.email} href={`mailto:${contact.email}`} />
          <ContactTile icon={Phone} label="Phone" value={contact.phone} href={`tel:${contact.phone.replace(/\s+/g, "")}`} />
          <ContactTile icon={MessageCircle} label="WhatsApp" value="Chat with us" href={contact.whatsapp} />
          <ContactTile icon={Send} label="Telegram" value="Join our channel" href={contact.telegram} />
        </div>
      </div>

      {/* Certificates */}
      <div className="mx-auto mt-16 max-w-4xl">
        <h2 className="text-center font-display text-2xl font-semibold text-parchment">
          Registration &amp; Legal Documents
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-parchment-muted">
          Transparency matters. View or download our government registration and compliance
          documents below.
        </p>
        {legal.note && (
          <p className="mx-auto mt-3 max-w-xl text-center text-xs text-parchment-muted">{legal.note}</p>
        )}
        {certsWithUrls.length === 0 ? (
          <p className="mt-8 text-center text-sm text-parchment-muted">
            Certificates will appear here once uploaded by the academy admin.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {certsWithUrls.map((cert) => (
              <div key={cert.id} className="card flex items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-gold-500" />
                  <div>
                    <p className="text-sm font-semibold text-parchment">{cert.title}</p>
                    {cert.description && (
                      <p className="text-xs text-parchment-muted">{cert.description}</p>
                    )}
                  </div>
                </div>
                {cert.url && (
                  <a href={cert.url} target="_blank" rel="noopener noreferrer" className="btn-ghost shrink-0">
                    <Download className="h-4 w-4" /> View
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="card card-hover flex items-start gap-3 p-5">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">{label}</p>
        <p className="mt-1 text-sm text-parchment">{value}</p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    content
  );
}

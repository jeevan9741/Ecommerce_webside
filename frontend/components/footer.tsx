import { MessageCircle, Send, MapPin, Mail, Phone } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { getShownContact } from "@/lib/contact";
import { telHref } from "@/lib/contact-values";
import { FooterExploreLinks } from "@/components/footer-explore-links";

export async function Footer() {
  // Cached and time-limited, so the footer never makes a marketing page wait on the backend. Only real,
  // admin-saved details are shown: no defaults, and no placeholder phone or link (see shownContact).
  const contact = await getShownContact();
  const hasContact = Boolean(contact.address || contact.email || contact.phone);

  return (
    <footer className="bg-gradient-to-br from-gold-600 to-gold-500">
      <div className="container-academy grid gap-10 py-14 md:grid-cols-4">
        <div className="min-w-0 md:col-span-2">
          <LogoMark variant="white" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-blue-100">
            Practical, outcome-focused e-commerce training — from your first listing to a
            scaled, profitable online store. Learn at your pace, in your language.
          </p>
          {(contact.whatsapp || contact.telegram) && (
            <div className="mt-5 flex items-center gap-3">
              {contact.whatsapp && (
                <a
                  href={contact.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-blue-100 transition hover:border-white hover:text-white"
                  aria-label="WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              )}
              {contact.telegram && (
                <a
                  href={contact.telegram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-blue-100 transition hover:border-white hover:text-white"
                  aria-label="Telegram"
                >
                  <Send className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white">Explore</h3>
          <ul className="space-y-2.5 text-sm text-blue-100">
            <FooterExploreLinks />
          </ul>
        </div>

        {hasContact && (
          <div className="min-w-0">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white">Contact</h3>
            <ul className="space-y-3 text-sm text-blue-100">
              {contact.address && (
                <li className="flex min-w-0 items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                  <span className="min-w-0 break-words">{contact.address}</span>
                </li>
              )}
              {contact.email && (
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                  <a href={`mailto:${contact.email}`} className="min-w-0 break-words hover:text-white">{contact.email}</a>
                </li>
              )}
              {contact.phone && (
                <li className="flex min-w-0 items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                  <a href={telHref(contact.phone)} className="min-w-0 break-words hover:text-white">{contact.phone}</a>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-white/15 py-6">
        <p className="container-academy text-center text-xs text-blue-100">
          © {new Date().getFullYear()} E-Commerce Training Academy. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

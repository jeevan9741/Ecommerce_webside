import Link from "next/link";
import { MessageCircle, Send, MapPin, Mail, Phone } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { getContact } from "@/lib/contact";
import { getSession } from "@/lib/session";

export async function Footer() {
  // The footer renders on every marketing page, so a backend hiccup falls back to
  // defaults instead of taking the whole page down with it.
  const [contact, session] = await Promise.all([getContact(), getSession().catch(() => null)]);
  const isAuthenticated = Boolean(session?.user);

  return (
    <footer className="bg-gradient-to-br from-gold-600 to-gold-500">
      <div className="container-academy grid gap-10 py-14 md:grid-cols-4">
        <div className="min-w-0 md:col-span-2">
          <LogoMark variant="white" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-blue-100">
            Practical, outcome-focused e-commerce training — from your first listing to a
            scaled, profitable online store. Learn at your pace, in your language.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <a
              href={contact.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-blue-100 transition hover:border-white hover:text-white"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
            <a
              href={contact.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-blue-100 transition hover:border-white hover:text-white"
              aria-label="Telegram"
            >
              <Send className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white">Explore</h3>
          <ul className="space-y-2.5 text-sm text-blue-100">
            {isAuthenticated ? (
              <>
                <li><Link href="/dashboard" className="hover:text-white">Dashboard</Link></li>
                <li><Link href="/courses" className="hover:text-white">Courses</Link></li>
              </>
            ) : (
              <li><Link href="/about" className="hover:text-white">About Us</Link></li>
            )}
          </ul>
        </div>

        <div className="min-w-0">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white">Contact</h3>
          <ul className="space-y-3 text-sm text-blue-100">
            <li className="flex min-w-0 items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white" />
              <span className="min-w-0 break-words">{contact.address}</span>
            </li>
            <li className="flex min-w-0 items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-white" />
              <span className="min-w-0 break-words">{contact.email}</span>
            </li>
            <li className="flex min-w-0 items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-white" />
              <span className="min-w-0 break-words">{contact.phone}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/15 py-6">
        <p className="container-academy text-center text-xs text-blue-100">
          © {new Date().getFullYear()} E-Commerce Training Academy. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

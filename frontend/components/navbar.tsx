"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Menu, X, LogOut, UserRound } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { homeFor } from "@/lib/routes";

const HOME_LINK = { href: "/", label: "Home" };
// Scrolls to the About section on the homepage (the Link handles the hash, even from another page).
const ABOUT_LINK = { href: "/#about", label: "About" };
const PORTAL_LINK = { href: "/dashboard", label: "My Portal" };
const ADMIN_LINK = { href: "/admin", label: "Admin" };

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { status, user, logout } = useAuth();
  const pathname = usePathname();
  const isAuthenticated = status === "authenticated";

  // Visitors see Home + About. Signed-in users are redirected away from the landing page by the
  // proxy, so they get their portal instead; the Admin link is only rendered for admin accounts.
  const navLinks = !isAuthenticated
    ? [HOME_LINK, ABOUT_LINK]
    : user?.role === "ADMIN"
      ? [PORTAL_LINK, ADMIN_LINK]
      : [PORTAL_LINK];

  // Lock background scroll while the drawer is open (links close it via their own onClick).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 bg-gradient-to-r from-gold-600 via-gold-500 to-[#2f6ff0] shadow-[0_6px_24px_-12px_rgba(29,78,216,0.6)]">
      {/* Three-column grid on desktop keeps the links centred on the page, whatever the logo and button widths. */}
      <nav className="container-academy flex h-16 items-center justify-between gap-4 sm:h-20 lg:h-[88px] xl:max-w-[1480px] md:grid md:grid-cols-[1fr_auto_1fr]">
        <Link href={isAuthenticated ? homeFor(user?.role) : "/"} className="min-w-0 shrink justify-self-start">
          <LogoMark variant="white" size="lg" />
        </Link>

        <div className="hidden items-center gap-10 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`relative whitespace-nowrap py-2 text-[15px] font-medium tracking-wide transition ${
                pathname === link.href
                  ? "text-white after:absolute after:-bottom-1 after:left-1/2 after:h-[2px] after:w-full after:-translate-x-1/2 after:rounded-full after:bg-white"
                  : "text-white/90 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden shrink-0 items-center gap-3 justify-self-end md:flex">
          {isAuthenticated ? (
            <button
              onClick={() => logout("/")}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-[15px] font-semibold text-gold-500 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.35)] transition hover:-translate-y-px hover:bg-blue-50 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          ) : status === "loading" ? null : (
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-2.5 text-base font-semibold text-gold-500 shadow transition hover:bg-blue-50 active:scale-[0.98]"
            >
              <UserRound className="h-4 w-4" />
              Login
            </Link>
          )}
        </div>

        <button
          className="-mr-2 shrink-0 rounded-lg p-2 text-white transition hover:bg-white/10 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 top-16 z-40 sm:top-20 bg-black/40 transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`absolute inset-x-0 top-16 z-40 origin-top overflow-hidden bg-gold-600 sm:top-20 shadow-xl transition-all duration-200 md:hidden ${
          open ? "max-h-[70vh] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-1 px-5 pb-6 pt-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`rounded-xl px-4 py-3.5 text-base font-medium transition ${
                pathname === link.href ? "bg-white/15 text-white" : "text-blue-50 hover:bg-white/10 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          ))}

          <div className="mt-3 border-t border-white/15 pt-4">
            {isAuthenticated ? (
              <button
                onClick={() => logout("/")}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-base font-semibold text-gold-500"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            ) : status === "loading" ? null : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-base font-semibold text-gold-500"
              >
                <UserRound className="h-4 w-4" />
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

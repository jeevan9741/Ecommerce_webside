"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Menu, X, LogOut, UserRound } from "lucide-react";
import { LogoMark } from "@/components/logo";

const PUBLIC_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
];

const AUTHENTICATED_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/courses", label: "Courses" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { status, logout } = useAuth();
  const pathname = usePathname();
  const isAuthenticated = status === "authenticated";

  const navLinks = isAuthenticated ? AUTHENTICATED_LINKS : PUBLIC_LINKS;

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
    <header className="sticky top-0 z-50 bg-gradient-to-r from-gold-500 to-gold-600 shadow-md">
      <nav className="container-academy flex h-20 items-center justify-between gap-4 py-3">
        <Link href={isAuthenticated ? "/dashboard" : "/"} className="shrink-0">
          <LogoMark variant="white" />
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`relative whitespace-nowrap py-1 text-base font-medium transition ${
                pathname === link.href
                  ? "text-white after:absolute after:-bottom-0.5 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-white"
                  : "text-blue-50 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {isAuthenticated ? (
            <button
              onClick={() => logout("/")}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-base font-semibold text-gold-500 shadow transition hover:bg-blue-50 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          ) : (
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
          className="-mr-2 rounded-lg p-2 text-white transition hover:bg-white/10 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 top-20 z-40 bg-black/40 transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`absolute inset-x-0 top-20 z-40 origin-top overflow-hidden bg-gold-600 shadow-xl transition-all duration-200 md:hidden ${
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
            ) : (
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

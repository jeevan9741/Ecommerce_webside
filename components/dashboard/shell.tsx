"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  Users,
  UserCog,
  BookOpen,
  Wallet,
  Briefcase,
  Star,
  FileText,
  Settings,
  Receipt,
  User,
  Languages,
} from "lucide-react";
import { LogoMark } from "@/components/logo";

const ICONS = {
  layoutDashboard: LayoutDashboard,
  users: Users,
  userCog: UserCog,
  bookOpen: BookOpen,
  wallet: Wallet,
  briefcase: Briefcase,
  star: Star,
  fileText: FileText,
  settings: Settings,
  receipt: Receipt,
  user: User,
  languages: Languages,
} as const;

export type DashboardIconName = keyof typeof ICONS;

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: DashboardIconName;
}

export function DashboardShell({
  navItems,
  userLabel,
  roleLabel,
  children,
  homeHref = "/",
}: {
  navItems: DashboardNavItem[];
  userLabel: string;
  roleLabel: string;
  children: React.ReactNode;
  homeHref?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Lock background scroll while the drawer is open (links close it via their own onClick).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const SidebarContent = (
    <div className="flex h-full flex-col bg-gradient-to-b from-gold-600 to-gold-500">
      <Link href={homeHref} className="px-6 py-6">
        <LogoMark variant="white" />
      </Link>
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = ICONS[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active ? "bg-white/15 text-white" : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/15 p-4">
        <p className="truncate text-sm font-medium text-white">{userLabel}</p>
        <p className="text-xs text-blue-100">{roleLabel}</p>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="btn-outline mt-3 w-full !py-2 text-xs"
        >
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-ink">
      <aside className="hidden w-64 shrink-0 lg:block">{SidebarContent}</aside>

      <div className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <aside
          className={`absolute left-0 top-0 h-full w-72 max-w-[85vw] shadow-2xl transition-transform duration-300 ease-out ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-5 z-10 rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {SidebarContent}
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border-soft bg-ink/95 px-5 py-4 backdrop-blur lg:hidden">
          <LogoMark className="scale-90" />
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="rounded-lg p-2 text-parchment transition hover:bg-surface-hover"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
        <main className="p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

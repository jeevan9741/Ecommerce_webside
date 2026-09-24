import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  Crown,
  Headset,
  Mail,
  MessageCircle,
  PlayCircle,
  Send,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { CoursePublic } from "@/components/course-card";
import type { Contact } from "@/lib/contact";
import { formatInr } from "@/lib/format";

type CourseType = CoursePublic["type"];

export interface EnrolledAccess {
  id: string;
  languageGranted: string | null;
  course: { id: string; title: string; type: CourseType; priceInPaise: number };
}

// Short package names shown on the portal cards; the price comes from the purchased course.
const PACKAGES: Record<CourseType, { name: string; icon: LucideIcon; action: string; actionIcon: LucideIcon }> = {
  EBOOK: { name: "E-Books", icon: BookOpen, action: "Open E-Books", actionIcon: BookOpen },
  VIDEO: { name: "Video Training", icon: Video, action: "Watch Video Hub", actionIcon: PlayCircle },
  ZOOM: { name: "Zoom Training", icon: Users, action: "Join Zoom Classes", actionIcon: Video },
  CENTRE: { name: "VIP Center Training", icon: Building2, action: "VIP Center / Zoom Access", actionIcon: Crown },
};

const PACKAGE_ORDER: CourseType[] = ["EBOOK", "VIDEO", "ZOOM", "CENTRE"];

export const packageName = (type: CourseType) => PACKAGES[type].name;

/** Orders packages from entry-level to VIP, regardless of purchase order. */
export function sortByPackage(access: EnrolledAccess[]) {
  return [...access].sort((a, b) => PACKAGE_ORDER.indexOf(a.course.type) - PACKAGE_ORDER.indexOf(b.course.type));
}

export function EnrolledPackages({ access, contact }: { access: EnrolledAccess[]; contact: Contact }) {
  return (
    <section>

      {access.length === 0 ? (
        <div className="card mt-4 flex flex-col items-center gap-4 p-10 text-center">
          <BookOpen className="h-10 w-10 text-gold-500" />
          <p className="text-sm text-parchment-muted">You haven&apos;t purchased any course yet.</p>
          <Link href="/courses" className="btn-gold">
            Browse Courses <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {sortByPackage(access).map((a) => (
            <PackageCard key={a.id} access={a} />
          ))}
        </div>
      )}

      <SupportCard contact={contact} />
    </section>
  );
}

export function PackageCard({ access }: { access: EnrolledAccess }) {
  const { course } = access;
  const pkg = PACKAGES[course.type];
  const Icon = pkg.icon;
  const ActionIcon = pkg.actionIcon;

  return (
    <div className="card flex h-full min-w-0 flex-col p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-md">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight text-gold-600">{formatInr(course.priceInPaise)}</p>
          <h3 className="font-display text-base font-semibold leading-snug text-parchment">{pkg.name}</h3>
        </div>
      </div>

      <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full border border-emerald bg-emerald/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald">
        Unlocked <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      {access.languageGranted && (
        <p className="mt-2 text-xs text-parchment-muted">Language: {access.languageGranted}</p>
      )}

      <div className="mt-auto pt-5">
        <Link href={`/dashboard/courses/${course.id}`} className="btn-gold btn-block !px-4 text-sm">
          <ActionIcon className="h-4 w-4 shrink-0" />
          {pkg.action}
        </Link>
      </div>
    </div>
  );
}

function SupportCard({ contact }: { contact: Contact }) {
  const links = [
    { href: contact.whatsapp, label: "WhatsApp", icon: MessageCircle, external: true },
    { href: contact.telegram, label: "Telegram", icon: Send, external: true },
    { href: `mailto:${contact.email}`, label: "Email Us", icon: Mail, external: false },
  ];

  return (
    <div className="card mt-5 flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold-600/40 bg-gold-500/10">
          <Headset className="h-5 w-5 text-gold-500" />
        </div>
        <div>
          <h3 className="font-semibold text-parchment">Need help with your package?</h3>
          <p className="mt-0.5 text-sm text-parchment-muted">Our support team is here for every enrolled student.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:shrink-0">
        {links.map(({ href, label, icon: LinkIcon, external }) => (
          <a
            key={label}
            href={href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="btn-outline !px-5 !py-2.5 text-sm"
          >
            <LinkIcon className="h-4 w-4" />
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}

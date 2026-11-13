import Link from "next/link";
import { Handshake } from "lucide-react";

/**
 * Shown in place of a franchise page whose feature is switched off: a friendly notice, never a login or
 * application form. It reads nothing from the server and grants nothing.
 */
export function FranchiseComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="container-academy py-14 sm:py-20">
      <div className="card mx-auto max-w-2xl p-8 text-center sm:p-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-100 text-gold-500">
          <Handshake className="h-7 w-7" aria-hidden="true" />
        </span>
        <span className="badge-pill mt-5">Coming soon</span>
        <h1 className="font-display mt-4 text-2xl font-bold text-parchment sm:text-3xl">{title}</h1>
        <div className="mx-auto mt-3 max-w-lg space-y-2 text-sm leading-relaxed text-parchment-muted sm:text-base">{children}</div>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/" className="btn-gold">
            Back to home
          </Link>
          <Link href="/#get-started" className="btn-outline">
            Explore our courses
          </Link>
        </div>
      </div>
    </div>
  );
}

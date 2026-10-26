"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, BookOpen, Download, FileText, Loader2, Lock, RotateCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatInr } from "@/lib/format";
import { formatBytes } from "@/services/videoService";
import { BuyCourseButton } from "@/components/buy-course-button";
import { learningService, openAfter, type PackageSummary, type StudentEBook } from "@/services/learningService";

type Data = { ebooks: StudentEBook[]; packages: PackageSummary[]; unlock: PackageSummary[] };

/**
 * The student's e-books with a Download button each. Downloads go through the API, which re-checks
 * the purchase and the e-book's language and returns a 5-minute signed link — nothing here is a
 * permanent file URL. E-books in languages the purchase doesn't include are shown locked, with an
 * option to buy that language. `courseId` narrows it to one package (its course page).
 */
export function EBookLibrary({ courseId }: { courseId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    learningService
      .myEBooks(courseId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your e-books."));
  }, [courseId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  if (error) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-danger" />
        <p className="text-sm text-danger">{error}</p>
        <button type="button" onClick={load} className="btn-outline btn-sm">
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading e-books">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton h-36 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (data.ebooks.length > 0) {
    // Available e-books first; the server's order is kept within each group.
    const ebooks = [...data.ebooks.filter((e) => !e.locked), ...data.ebooks.filter((e) => e.locked)];
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {ebooks.map((e) => (
          <EBookCard
            key={e.id}
            ebook={e}
            showPackage={!courseId && data.packages.length > 1}
            pkg={data.packages.find((p) => p.id === e.course.id)}
          />
        ))}
      </div>
    );
  }

  if (data.packages.length > 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <BookOpen className="h-10 w-10 text-gold-500" />
        <p className="font-semibold text-parchment">Your e-books are on the way</p>
        <p className="max-w-md text-sm text-parchment-muted">
          They&apos;ll appear here for download as soon as the academy uploads them. Need something now? Contact support from your dashboard.
        </p>
      </div>
    );
  }

  return <Locked packages={data.unlock} what="e-books" />;
}

function EBookCard({ ebook, showPackage, pkg }: { ebook: StudentEBook; showPackage: boolean; pkg?: PackageSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await openAfter(async () => (await learningService.downloadEBook(ebook.id)).url);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Your access to this e-book isn't active. Contact support if you think this is a mistake."
          : err instanceof ApiError && err.status === 429
            ? err.message
            : "The download couldn't start. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex h-full min-w-0 flex-col p-5">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md ${
            ebook.locked ? "bg-parchment-muted/60" : "bg-gradient-to-br from-gold-400 to-gold-600"
          }`}
        >
          {ebook.locked ? <Lock className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug text-parchment [overflow-wrap:anywhere]">{ebook.title}</h3>
          <p className="mt-0.5 text-xs text-parchment-muted">
            {ebook.format} · {formatBytes(ebook.sizeBytes)}
            {ebook.category && <> · {ebook.category.name}</>}
            {ebook.language && <> · {ebook.language.name}</>}
            {showPackage && <> · {ebook.course.title}</>}
          </p>
        </div>
      </div>
      {ebook.description && <p className="mt-3 whitespace-pre-line text-sm text-parchment-muted">{ebook.description}</p>}
      <div className="mt-auto pt-4">
        {ebook.locked ? (
          <LockedLanguage ebook={ebook} pkg={pkg} />
        ) : (
          <>
            <button type="button" onClick={download} disabled={busy} className="btn-gold btn-block !px-4 text-sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy ? "Preparing download…" : "Download E-Book"}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A language the purchase doesn't include. E-book packages sell each language separately, so the
 * customer can buy it here (the server re-validates); other packages just say it isn't included.
 */
function LockedLanguage({ ebook, pkg }: { ebook: StudentEBook; pkg?: PackageSummary }) {
  const language = ebook.language!;
  if (!pkg || pkg.type !== "EBOOK") {
    return <p className="text-xs text-parchment-muted">The {language.name} e-book isn&apos;t included in your purchase.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-parchment-muted">Not included in your purchase — your package unlocks the language you bought.</p>
      <BuyCourseButton
        course={{ id: pkg.id, slug: "", type: pkg.type, title: pkg.title, shortDescription: "", priceInPaise: pkg.priceInPaise, languages: [] }}
        language={{ code: language.code, name: language.name, nativeName: language.name }}
        label={`Buy ${language.name} · ${formatInr(pkg.priceInPaise)}`}
      />
    </div>
  );
}

/** Shown to customers who haven't bought a package with this content. */
export function Locked({ packages, what }: { packages: PackageSummary[]; what: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <Lock className="h-10 w-10 text-gold-500" />
      <p className="font-semibold text-parchment">Unlock {what}</p>
      <p className="max-w-md text-sm text-parchment-muted">
        {packages.length > 0
          ? `Available with ${packages.map((p) => `${p.title} (${formatInr(p.priceInPaise)})`).join(" or ")}.`
          : `${what[0].toUpperCase()}${what.slice(1)} come with selected packages.`}
      </p>
      <Link href="/courses" className="btn-gold btn-sm mt-1">
        View packages
      </Link>
    </div>
  );
}

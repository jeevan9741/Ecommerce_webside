"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Clock, Info, Loader2, Search, Store } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";
import { StreamOnlyVideo } from "@/components/videos/stream-only-video";
import { courseService, type DemoPlatform, type PublicDemoVideo } from "@/services/courseService";

/**
 * Homepage demo flow: one common demo video for every visitor. It plays in the visitor's language
 * when that version exists, otherwise in English (flagged); English is the default until a language
 * is chosen. The platform names (Meesho / Amazon / Flipkart / Shopify …) are display-only labels.
 * The language picker, labels and player live in different parts of the page, so their state is
 * shared through this provider.
 */

interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

type VideoState =
  | { status: "loading" }
  | { status: "ready"; video: PublicDemoVideo }
  | { status: "empty" }
  | { status: "error" };

interface DemoState {
  languages: LanguageOption[];
  languagesLoaded: boolean;
  selectedCode: string;
  selectLanguage: (code: string) => void;
  platforms: DemoPlatform[] | null;
  video: VideoState;
}

const LANG_COOKIE = "eca_lang";
const DEFAULT_LANGUAGE = "en";
export const FALLBACK_NOTICE = "Selected language version is coming soon. Showing the English demo.";

function remember(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  try {
    localStorage.setItem(name, value);
  } catch {
    // localStorage may be unavailable (private mode); the cookie still persists the choice.
  }
}

function recall(name: string): string | null {
  try {
    const fromStorage = localStorage.getItem(name);
    if (fromStorage) return fromStorage;
  } catch {
    // ignore
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const DemoContext = createContext<DemoState | null>(null);

export function DemoLanguageProvider({ children }: { children: React.ReactNode }) {
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [languagesLoaded, setLanguagesLoaded] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [platforms, setPlatforms] = useState<DemoPlatform[] | null>(null);
  const [videoResult, setVideoResult] = useState<{ lang: string; state: VideoState } | null>(null);

  // Only a returning visitor's remembered language is preselected; everyone else gets English.
  useEffect(() => {
    courseService
      .languages()
      .then(({ languages: list }) => {
        setLanguages(list);
        const remembered = recall(LANG_COOKIE);
        if (remembered && list.some((l) => l.code === remembered)) setSelectedCode(remembered);
      })
      .catch(() => setLanguages([]))
      .finally(() => setLanguagesLoaded(true));
    courseService
      .demoPlatforms()
      .then(({ platforms: list }) => setPlatforms(list))
      .catch(() => setPlatforms([]));
  }, []);

  // Wait for the remembered language so a returning visitor doesn't load the English demo first.
  const videoLang = languagesLoaded ? selectedCode || DEFAULT_LANGUAGE : "";

  useEffect(() => {
    if (!videoLang) return;
    let cancelled = false;
    courseService
      .demoVideo(videoLang)
      .then(({ video }) => !cancelled && setVideoResult({ lang: videoLang, state: video ? { status: "ready", video } : { status: "empty" } }))
      .catch(() => !cancelled && setVideoResult({ lang: videoLang, state: { status: "error" } }));
    return () => {
      cancelled = true;
    };
  }, [videoLang]);

  const video: VideoState = videoLang && videoResult?.lang === videoLang ? videoResult.state : { status: "loading" };

  const selectLanguage = useCallback((code: string) => {
    setSelectedCode(code);
    remember(LANG_COOKIE, code);
  }, []);

  return (
    <DemoContext.Provider value={{ languages, languagesLoaded, selectedCode, selectLanguage, platforms, video }}>
      {children}
    </DemoContext.Provider>
  );
}

function useDemoState(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoState must be used within a DemoLanguageProvider");
  return ctx;
}

/** Step 1: searchable language dropdown. */
export function DemoLanguagePicker() {
  const { languages, languagesLoaded, selectedCode, selectLanguage } = useDemoState();

  if (!languagesLoaded) {
    return (
      <div className="input-field flex items-center gap-2 !py-4 text-sm text-parchment-muted">
        <Search className="h-4 w-4 shrink-0 text-gold-500" /> Loading languages…
      </div>
    );
  }

  return (
    <LanguageSelector
      languages={languages}
      value={selectedCode}
      onChange={selectLanguage}
      placeholder="Search and select your language..."
      icon={Search}
      triggerClassName="!rounded-xl !py-4 !text-base shadow-sm"
    />
  );
}

/**
 * Brand-coloured monogram tiles — original marks in each platform's colours, deliberately not
 * reproductions of their trademarked logos. Unknown platforms fall back to a store icon.
 */
const PLATFORM_TILE: Record<string, { mark: string; className: string }> = {
  meesho: { mark: "M", className: "bg-gradient-to-br from-[#c1279f] to-[#7a1a6b]" },
  amazon: { mark: "a", className: "bg-gradient-to-br from-[#232f3e] to-[#131a22] text-[#ff9900]" },
  flipkart: { mark: "F", className: "bg-gradient-to-br from-[#2874f0] to-[#1a4fb5] text-[#ffe500]" },
  shopify: { mark: "S", className: "bg-gradient-to-br from-[#95bf47] to-[#5e8e3e]" },
};

function PlatformTile({ slug }: { slug: string }) {
  const tile = PLATFORM_TILE[slug];
  return (
    <span
      aria-hidden="true"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-extrabold text-white shadow-[0_8px_18px_-8px_rgba(15,23,42,0.55)] ring-1 ring-white/20 sm:h-12 sm:w-12 ${
        tile?.className ?? "bg-gradient-to-br from-gold-400 to-gold-600"
      }`}
    >
      {tile ? tile.mark : <Store className="h-5 w-5" />}
    </span>
  );
}

/** The platforms the training covers, as plain informational labels — they don't choose a video. */
export function DemoPlatformLabels() {
  const { platforms } = useDemoState();

  if (!platforms) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }
  if (platforms.length === 0) return null;

  return (
    <ul aria-label="Platforms covered in the training" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {platforms.map((p) => (
        <li
          key={p.slug}
          className="flex h-full min-w-0 cursor-default select-none items-center gap-3 rounded-2xl border border-border-soft bg-gradient-to-br from-white to-gold-100/40 px-3.5 py-3 shadow-[0_10px_30px_-22px_rgba(37,99,235,0.6)] sm:gap-3.5 sm:px-4 sm:py-3.5"
        >
          <PlatformTile slug={p.slug} />
          <span className="min-w-0 truncate text-[15px] font-bold tracking-tight text-parchment sm:text-base">{p.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one demo player. It only exists when there's a video to play; every other state (loading,
 * no demo uploaded yet, error) is a panel, never an empty player.
 */
export function DemoVideoPlayer() {
  const { selectedCode, video } = useDemoState();

  if (video.status === "ready") {
    const v = video.video;
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gold-500">Free demo</p>
          <h3 className="mt-0.5 font-display text-lg font-bold text-parchment sm:text-xl">{v.title}</h3>
          <p className="mt-0.5 text-xs text-parchment-muted">{v.languageName}</p>
        </div>
        {/* Only worth saying when the visitor actually asked for another language. */}
        {v.languageFallback && selectedCode && selectedCode !== DEFAULT_LANGUAGE && (
          <p role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5 text-sm text-parchment">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" /> {FALLBACK_NOTICE}
          </p>
        )}
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-black shadow-[0_25px_60px_-20px_rgba(15,23,42,0.35)]">
          <StreamOnlyVideo
            key={v.url}
            src={v.url}
            poster={v.thumbnailUrl ?? undefined}
            playsInline
            preload="metadata"
            title={v.title}
            className="aspect-video w-full bg-black"
          />
        </div>
        {v.description && <p className="mt-3 px-1 text-xs text-parchment-muted sm:text-sm">{v.description}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {video.status === "loading" ? (
        <div className="flex aspect-video items-center justify-center rounded-2xl border border-border-soft bg-ink-elevated">
          <Loader2 className="h-8 w-8 animate-spin text-gold-500" aria-label="Loading the demo" />
        </div>
      ) : video.status === "empty" ? (
        <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-border-soft bg-ink-elevated px-6 py-12 text-center shadow-sm sm:py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold-600">
            <Clock className="h-3.5 w-3.5" /> Coming soon
          </span>
          <h3 className="font-display text-lg font-bold text-parchment sm:text-xl">The demo video is on its way</h3>
          <p className="mx-auto max-w-md text-sm text-parchment-muted">We&apos;re preparing the free demo. Please check back soon.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gold-500/40 bg-ink-elevated/60 px-6 py-12 text-center text-sm text-parchment-muted sm:py-16">
          <Info className="h-7 w-7 text-gold-500" />
          The demo couldn&apos;t be loaded. Please try again in a moment.
        </div>
      )}
    </div>
  );
}

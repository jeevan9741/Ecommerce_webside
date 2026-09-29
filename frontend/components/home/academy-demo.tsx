"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Check, Clock, Globe2, Info, Loader2, MousePointerClick, Search } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";
import { StreamOnlyVideo } from "@/components/videos/stream-only-video";
import { PlatformTile } from "@/components/home/platform-tile";
import { courseService, type DemoPlatform, type PublicDemoVideo } from "@/services/courseService";

/**
 * Homepage demo flow: 1. language → 2. platform (Meesho / Amazon / Flipkart / Shopify …) → 3. that
 * platform's demo in that language, or its English demo (flagged), or a "coming soon" panel.
 * The language picker, platform cards and player live in different parts of the page, so their
 * state is shared through this provider.
 */

interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

type VideoState =
  | { status: "idle" }
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
  selectedPlatform: string;
  selectPlatform: (slug: string) => void;
  video: VideoState;
  /** Set when the visitor picked a platform in this visit, so the player may start on its own. */
  autoPlay: boolean;
}

const LANG_COOKIE = "eca_lang";
const PLATFORM_COOKIE = "eca_demo_platform";
const PLAYER_ID = "demo-player";
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
  const [platformResult, setPlatformResult] = useState<{ forCode: string; platforms: DemoPlatform[] } | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [videoResult, setVideoResult] = useState<{ key: string; state: VideoState } | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);

  // Language first: only a returning visitor's remembered choice is preselected.
  useEffect(() => {
    courseService
      .languages()
      .then(({ languages: list }) => {
        setLanguages(list);
        const remembered = recall(LANG_COOKIE);
        if (remembered && list.some((l) => l.code === remembered)) setSelectedCode(remembered);
        const platform = recall(PLATFORM_COOKIE);
        if (platform) setSelectedPlatform(platform);
      })
      .catch(() => setLanguages([]))
      .finally(() => setLanguagesLoaded(true));
  }, []);

  useEffect(() => {
    if (!selectedCode) return;
    let cancelled = false;
    courseService
      .demoPlatforms(selectedCode)
      .then(({ platforms }) => !cancelled && setPlatformResult({ forCode: selectedCode, platforms }))
      .catch(() => !cancelled && setPlatformResult({ forCode: selectedCode, platforms: [] }));
    return () => {
      cancelled = true;
    };
  }, [selectedCode]);

  const platforms = platformResult?.forCode === selectedCode ? platformResult.platforms : null;
  // A remembered platform that's no longer offered is ignored.
  const activePlatform = platforms?.some((p) => p.slug === selectedPlatform) ? selectedPlatform : "";
  const videoKey = selectedCode && activePlatform ? `${selectedCode}:${activePlatform}` : "";

  useEffect(() => {
    if (!videoKey) return;
    const [lang, platform] = videoKey.split(":");
    let cancelled = false;
    courseService
      .demoVideo(lang, platform)
      .then(({ video }) => !cancelled && setVideoResult({ key: videoKey, state: video ? { status: "ready", video } : { status: "empty" } }))
      .catch(() => !cancelled && setVideoResult({ key: videoKey, state: { status: "error" } }));
    return () => {
      cancelled = true;
    };
  }, [videoKey]);

  const video: VideoState = !videoKey
    ? { status: "idle" }
    : videoResult?.key === videoKey
      ? videoResult.state
      : { status: "loading" };

  const selectLanguage = useCallback((code: string) => {
    setSelectedCode(code);
    remember(LANG_COOKIE, code);
  }, []);

  const selectPlatform = useCallback((slug: string) => {
    setSelectedPlatform(slug);
    setAutoPlay(true);
    remember(PLATFORM_COOKIE, slug);
    // Bring the (single) player into view — on phones it's well below the cards. Its container
    // always exists (a panel until a video loads), so no need to wait for a render.
    document.getElementById(PLAYER_ID)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <DemoContext.Provider
      value={{
        languages,
        languagesLoaded,
        selectedCode,
        selectLanguage,
        platforms,
        selectedPlatform: activePlatform,
        selectPlatform,
        video,
        autoPlay,
      }}
    >
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

/** Step 2: platform cards, shown once a language is chosen. The selected card is highlighted. */
export function DemoPlatformPicker() {
  const { languages, selectedCode, platforms, selectedPlatform, selectPlatform } = useDemoState();
  const languageName = languages.find((l) => l.code === selectedCode)?.name ?? "";

  if (!selectedCode) {
    return (
      <p className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-gold-500/40 bg-ink-elevated/60 px-4 py-6 text-center text-sm text-parchment-muted">
        <Globe2 className="h-4 w-4 shrink-0 text-gold-500" /> Select your language above to see the platform demos.
      </p>
    );
  }
  if (!platforms) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }
  if (platforms.length === 0) {
    return <p className="text-center text-sm text-parchment-muted">Platform demos are coming soon.</p>;
  }

  return (
    <div role="radiogroup" aria-label="Choose a platform" className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
      {platforms.map((p) => {
        const selected = p.slug === selectedPlatform;
        return (
          <button
            key={p.slug}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => selectPlatform(p.slug)}
            className={`group relative flex overflow-hidden rounded-2xl border bg-ink-elevated text-left shadow-sm transition sm:flex-col ${
              selected
                ? "border-gold-500 ring-2 ring-gold-500 ring-offset-2 ring-offset-gold-100"
                : "border-border-soft hover:-translate-y-0.5 hover:border-gold-500/60 hover:shadow-md"
            }`}
          >
            <PlatformTile name={p.name} className="w-28 shrink-0 sm:h-24 sm:w-full" />
            <span className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold text-parchment">{p.name}</span>
                {selected && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-500 text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
              {p.description && <span className="mt-1 text-xs leading-relaxed text-parchment-muted sm:text-[13px]">{p.description}</span>}
              <span className="mt-2">
                <StatusBadge status={p.status} languageName={languageName} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ status, languageName }: { status: DemoPlatform["status"]; languageName: string }) {
  const [label, tone] =
    status === "available"
      ? [`${languageName} demo`, "border-emerald/30 bg-emerald/10 text-emerald"]
      : status === "fallback"
        ? ["English demo", "border-gold-500/30 bg-gold-500/10 text-gold-600"]
        : ["Coming soon", "border-border-soft bg-surface-hover text-parchment-muted"];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

/**
 * Step 3: the one demo player. It only exists when there's a video to play; every other state
 * (nothing chosen yet, loading, no demo for the platform, error) is a panel, never an empty player.
 */
export function DemoVideoPlayer() {
  const { selectedCode, selectedPlatform, platforms, video, autoPlay } = useDemoState();
  const platform = platforms?.find((p) => p.slug === selectedPlatform);

  if (video.status === "ready") {
    const v = video.video;
    const platformName = v.platform?.name ?? platform?.name ?? "Platform";
    return (
      <div id={PLAYER_ID} className="mx-auto max-w-4xl scroll-mt-24">
        <div className="mb-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gold-500">{platformName} demo</p>
          <h3 className="mt-0.5 font-display text-lg font-bold text-parchment sm:text-xl">{v.title}</h3>
          <p className="mt-0.5 text-xs text-parchment-muted">{v.languageName}</p>
        </div>
        {v.languageFallback && (
          <p role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5 text-sm text-parchment">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" /> {FALLBACK_NOTICE}
          </p>
        )}
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-black shadow-[0_25px_60px_-20px_rgba(15,23,42,0.35)]">
          <StreamOnlyVideo
            key={v.url}
            src={v.url}
            poster={v.thumbnailUrl ?? undefined}
            autoPlay={autoPlay}
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
    <div id={PLAYER_ID} className="mx-auto max-w-4xl scroll-mt-24">
      {video.status === "loading" ? (
        <div className="flex aspect-video items-center justify-center rounded-2xl border border-border-soft bg-ink-elevated">
          <Loader2 className="h-8 w-8 animate-spin text-gold-500" aria-label="Loading the demo" />
        </div>
      ) : video.status === "empty" && platform ? (
        <div role="status" className="flex flex-col items-center gap-4 rounded-2xl border border-border-soft bg-ink-elevated px-6 py-12 text-center shadow-sm sm:py-16">
          <PlatformTile name={platform.name} className="h-20 w-40 rounded-xl shadow-sm" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold-600">
            <Clock className="h-3.5 w-3.5" /> Coming soon
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-parchment sm:text-xl">The {platform.name} demo is on its way</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-parchment-muted">
              We&apos;re preparing this demo. Pick another platform above to watch its demo in the meantime.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gold-500/40 bg-ink-elevated/60 px-6 py-12 text-center text-sm text-parchment-muted sm:py-16">
          <MousePointerClick className="h-7 w-7 text-gold-500" />
          {video.status === "error"
            ? "The demo couldn't be loaded. Please try again in a moment."
            : !selectedCode
              ? "Choose your language, then pick a platform to watch its free demo."
              : "Pick a platform above to watch its free demo."}
        </div>
      )}
    </div>
  );
}

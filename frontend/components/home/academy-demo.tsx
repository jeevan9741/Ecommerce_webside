"use client";

import { backendFetch } from "@/lib/api";

import { createContext, useContext, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";
import { StreamOnlyVideo } from "@/components/videos/stream-only-video";
import type { PublicDemoVideo } from "@/services/courseService";

interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

interface DemoState {
  languages: LanguageOption[];
  languagesLoaded: boolean;
  selectedCode: string;
  selectLanguage: (code: string) => void;
  videoStatus: "loading" | "ready" | "empty";
  video: PublicDemoVideo | null;
}

const LANG_COOKIE = "eca_lang";

function rememberLanguage(code: string) {
  document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  try {
    localStorage.setItem(LANG_COOKIE, code);
  } catch {
    // localStorage may be unavailable (private mode); the cookie still persists the choice.
  }
}

function getRememberedLanguage(): string | null {
  try {
    const fromStorage = localStorage.getItem(LANG_COOKIE);
    if (fromStorage) return fromStorage;
  } catch {
    // ignore
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const DemoContext = createContext<DemoState | null>(null);

/**
 * Holds the language + demo-video state shared by the Demo Video section and the
 * Language Selector inside Get Started — they live in different parts of the page
 * layout but must stay in sync (picking a language updates the video instantly).
 */
export function DemoLanguageProvider({ children }: { children: React.ReactNode }) {
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [languagesLoaded, setLanguagesLoaded] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [videoResult, setVideoResult] = useState<{
    forCode: string;
    status: "ready" | "empty";
    video: PublicDemoVideo | null;
  } | null>(null);

  const videoStatus = videoResult?.forCode === selectedCode ? videoResult.status : "loading";
  const video = videoResult?.forCode === selectedCode ? videoResult.video : null;

  useEffect(() => {
    backendFetch("/api/languages")
      .then((r) => r.json())
      .then((data) => {
        const list: LanguageOption[] = data.languages ?? [];
        setLanguages(list);
        const remembered = getRememberedLanguage();
        const initial =
          (remembered && list.find((l) => l.code === remembered)) ??
          list.find((l) => l.code === "en") ??
          list[0];
        if (initial) setSelectedCode(initial.code);
      })
      .catch(() => setLanguages([]))
      .finally(() => setLanguagesLoaded(true));
  }, []);

  useEffect(() => {
    if (!selectedCode) return;
    let cancelled = false;

    backendFetch(`/api/demo-videos?lang=${selectedCode}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data.video) throw new Error("not found");
        setVideoResult({ forCode: selectedCode, status: "ready", video: data.video });
      })
      .catch(() => {
        if (!cancelled) {
          setVideoResult({ forCode: selectedCode, status: "empty", video: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCode]);

  function selectLanguage(code: string) {
    setSelectedCode(code);
    rememberLanguage(code);
  }

  return (
    <DemoContext.Provider
      value={{ languages, languagesLoaded, selectedCode, selectLanguage, videoStatus, video }}
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

/**
 * Large embedded-video-style player for the free demo (no login). Content is real (per-language,
 * admin-uploaded); it streams only — no download button, picture-in-picture or "Save video as".
 */
export function DemoVideoPlayer() {
  const { videoStatus, video } = useDemoState();

  return (
    <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border-soft bg-black shadow-[0_25px_60px_-20px_rgba(15,23,42,0.35)]">
      <div className="flex aspect-video items-center justify-center bg-black">
        {videoStatus === "loading" && <Loader2 className="h-8 w-8 animate-spin text-gold-500" />}
        {videoStatus === "empty" && (
          <p className="px-6 text-center text-sm text-parchment-muted">
            Our demo video is being prepared for this language — pick another language below, or check back soon.
          </p>
        )}
        {videoStatus === "ready" && video && (
          <StreamOnlyVideo
            key={video.url}
            src={video.url}
            poster={video.thumbnailUrl ?? undefined}
            playsInline
            preload="metadata"
            title={video.title}
            className="h-full w-full bg-black"
          />
        )}
      </div>
      {videoStatus === "ready" && video && (video.title || video.description) && (
        <div className="border-t border-white/10 bg-[#0b0f1f] px-4 py-3 sm:px-6">
          <p className="text-sm font-semibold text-white sm:text-base">{video.title}</p>
          {video.description && <p className="mt-0.5 text-xs text-white/70 sm:text-sm">{video.description}</p>}
        </div>
      )}
    </div>
  );
}

/** Searchable language dropdown, placed inside the "Get Started" card. */
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

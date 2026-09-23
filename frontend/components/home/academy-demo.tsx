"use client";

import { backendFetch } from "@/lib/api";

import { createContext, useContext, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";

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
  videoUrl: string | null;
  videoLanguageName: string | null;
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
    url: string | null;
    languageName: string | null;
  } | null>(null);

  const videoStatus = videoResult?.forCode === selectedCode ? videoResult.status : "loading";
  const videoUrl = videoResult?.forCode === selectedCode ? videoResult.url : null;
  const videoLanguageName = videoResult?.forCode === selectedCode ? videoResult.languageName : null;

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
        setVideoResult({
          forCode: selectedCode,
          status: "ready",
          url: data.video.url,
          languageName: data.video.languageName,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setVideoResult({ forCode: selectedCode, status: "empty", url: null, languageName: null });
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
      value={{ languages, languagesLoaded, selectedCode, selectLanguage, videoStatus, videoUrl, videoLanguageName }}
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

/** Large embedded-video-style player. Content is real (per-language, admin-uploaded); only the chrome is styled to look like a video platform embed. */
export function DemoVideoPlayer() {
  const { videoStatus, videoUrl } = useDemoState();

  return (
    <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border-soft bg-black shadow-[0_25px_60px_-20px_rgba(15,23,42,0.35)]">
      <div className="flex aspect-video items-center justify-center bg-black">
        {videoStatus === "loading" && <Loader2 className="h-8 w-8 animate-spin text-gold-500" />}
        {videoStatus === "empty" && (
          <p className="px-6 text-center text-sm text-parchment-muted">
            Our demo video is being prepared for this language — pick another language below, or check back soon.
          </p>
        )}
        {videoStatus === "ready" && videoUrl && (
          <video src={videoUrl} controls playsInline className="h-full w-full bg-black" />
        )}
      </div>
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

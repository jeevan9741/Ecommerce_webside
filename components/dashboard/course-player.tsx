"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Download, Loader2, PlayCircle, Video as VideoIcon } from "lucide-react";
import { LanguageSelector } from "@/components/language-selector";

interface LanguageContent {
  code: string;
  name: string;
  nativeName: string;
  videoUrl: string | null;
  subtitleUrl: string | null;
  ebookUrl: string | null;
}

interface LessonContent {
  id: string;
  title: string;
  videoUrl: string | null;
  subtitleUrl: string | null;
}

interface ModuleContent {
  id: string;
  title: string;
  lessons: LessonContent[];
}

export function CoursePlayer({
  courseId,
  type,
  defaultLanguageCode,
}: {
  courseId: string;
  type: "EBOOK" | "VIDEO";
  defaultLanguageCode: string | null;
}) {
  const [languages, setLanguages] = useState<LanguageContent[] | null>(null);
  const [modules, setModules] = useState<ModuleContent[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    fetch(`/api/courses/${courseId}/content`)
      .then((r) => r.json())
      .then((data) => {
        const list: LanguageContent[] = data.languages ?? [];
        setLanguages(list);
        setModules(data.modules ?? []);
        const preferred =
          (defaultLanguageCode && list.find((l) => l.code === defaultLanguageCode)?.code) || list[0]?.code || "";
        setSelected(preferred);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  if (!languages) {
    return (
      <div className="mt-8 flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gold-500" />
      </div>
    );
  }

  const hasCurriculum = type === "VIDEO" && modules.length > 0;

  if (languages.length === 0 && !hasCurriculum) {
    return (
      <div className="mt-8 card p-8 text-center text-sm text-parchment-muted">
        {type === "EBOOK"
          ? "Your e-book will appear here once uploaded by the academy."
          : "Your videos will appear here once uploaded by the academy."}
      </div>
    );
  }

  const current = languages.find((l) => l.code === selected) ?? languages[0];
  const asset = current ? (type === "EBOOK" ? current.ebookUrl : current.videoUrl) : null;

  return (
    <div className="mt-8 space-y-5">
      {hasCurriculum && <CourseCurriculum modules={modules} />}

      {languages.length > 0 && (
        <>
          <div className="max-w-xs">
            <label className="label-field">Language</label>
            <LanguageSelector languages={languages} value={selected} onChange={setSelected} />
          </div>

          <div className="card p-5">
            {!asset ? (
              <p className="text-sm text-parchment-muted">
                This course is currently not available in your selected language.
              </p>
            ) : type === "EBOOK" ? (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-gold-500" />
                  <span className="text-sm font-medium text-parchment">{current.name} E-Book</span>
                </div>
                <a href={asset} target="_blank" rel="noopener noreferrer" className="btn-gold !px-4 !py-2 text-xs">
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <VideoIcon className="h-4 w-4 text-gold-500" />
                  <span className="text-sm font-medium text-parchment">{current.name}</span>
                </div>
                <video key={current.code} src={asset} controls className="w-full rounded-xl border border-border-soft">
                  {current.subtitleUrl && (
                    <track kind="subtitles" src={current.subtitleUrl} srcLang={current.code} label={current.name} default />
                  )}
                </video>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CourseCurriculum({ modules }: { modules: ModuleContent[] }) {
  const firstLesson = modules.find((m) => m.lessons.length > 0)?.lessons[0] ?? null;
  const [activeLessonId, setActiveLessonId] = useState<string | null>(firstLesson?.id ?? null);
  const [openModuleId, setOpenModuleId] = useState<string | null>(modules[0]?.id ?? null);

  const activeLesson = modules.flatMap((m) => m.lessons).find((l) => l.id === activeLessonId) ?? null;

  return (
    <div className="space-y-4">
      {activeLesson?.videoUrl && (
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2">
            <VideoIcon className="h-4 w-4 text-gold-500" />
            <span className="text-sm font-medium text-parchment">{activeLesson.title}</span>
          </div>
          <video key={activeLesson.id} src={activeLesson.videoUrl} controls className="w-full rounded-xl border border-border-soft">
            {activeLesson.subtitleUrl && <track kind="subtitles" src={activeLesson.subtitleUrl} default />}
          </video>
        </div>
      )}

      <div className="card divide-y divide-border-soft overflow-hidden !p-0">
        {modules.map((m, mi) => {
          const isOpen = openModuleId === m.id;
          return (
            <div key={m.id}>
              <button
                type="button"
                onClick={() => setOpenModuleId(isOpen ? null : m.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
              >
                <span className="font-medium text-parchment">
                  Module {mi + 1}: {m.title}
                </span>
                <ChevronDown className={`h-4 w-4 text-parchment-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="space-y-1 border-t border-border-soft p-2">
                  {m.lessons.length === 0 && (
                    <p className="px-2 py-2 text-xs text-parchment-muted">No lessons uploaded yet.</p>
                  )}
                  {m.lessons.map((l, li) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => l.videoUrl && setActiveLessonId(l.id)}
                      disabled={!l.videoUrl}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        activeLessonId === l.id ? "bg-gold-500/10 text-gold-500" : "text-parchment-muted hover:bg-border-soft/40"
                      }`}
                    >
                      <PlayCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        Lesson {li + 1}: {l.title}
                      </span>
                      {!l.videoUrl && <span className="ml-auto shrink-0 text-xs">Coming soon</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

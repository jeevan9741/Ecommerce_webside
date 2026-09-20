"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Globe2, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface LanguageOption {
  code: string;
  name: string;
  nativeName?: string;
}

const LIST_MAX_HEIGHT = 300;

export function LanguageSelector({
  languages,
  value,
  onChange,
  placeholder = "Select a language",
  className = "",
  triggerClassName = "",
  icon: TriggerIcon = Globe2,
}: {
  languages: LanguageOption[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `lang-listbox-${useId()}`;

  const selected = languages.find((l) => l.code === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) => l.name.toLowerCase().includes(q) || l.nativeName?.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }, [languages, query]);

  useEffect(() => {
    // Portals must not render during SSR; flip after the first client render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  function updateRect() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updateRect();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onReposition() {
      updateRect();
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  function selectLanguage(lang: LanguageOption) {
    onChange(lang.code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function openPanel() {
    setQuery("");
    setHighlighted(0);
    setOpen(true);
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPanel();
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlighted(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const lang = filtered[highlighted];
      if (lang) selectLanguage(lang);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const activeOptionId = filtered[highlighted] ? `${listboxId}-opt-${filtered[highlighted].code}` : undefined;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onTriggerKeyDown}
        className={`input-field flex w-full items-center justify-between gap-2 text-left ${triggerClassName}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <TriggerIcon className="h-4 w-4 shrink-0 text-gold-500" />
          <span className="truncate">
            {selected ? (
              <>
                {selected.name}
                {selected.nativeName && selected.nativeName !== selected.name && (
                  <span className="text-parchment-muted"> · {selected.nativeName}</span>
                )}
              </>
            ) : (
              <span className="text-parchment-muted/70">{placeholder}</span>
            )}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-parchment-muted transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        mounted &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
            className="z-[100] overflow-hidden rounded-xl border border-gold-500/30 bg-ink-elevated shadow-[0_20px_45px_-16px_rgba(37,99,235,0.25)]"
          >
            <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-parchment-muted" />
              <input
                ref={inputRef}
                autoFocus
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search language..."
                className="w-full bg-transparent text-sm text-parchment outline-none placeholder:text-parchment-muted/60"
              />
            </div>
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Languages"
              style={{ maxHeight: LIST_MAX_HEIGHT }}
              className="overflow-y-auto overscroll-contain py-1"
            >
              {filtered.length === 0 && (
                <li className="px-4 py-3 text-sm text-parchment-muted" role="presentation">
                  No languages found.
                </li>
              )}
              {filtered.map((lang, i) => (
                <li key={lang.code} role="presentation">
                  <button
                    id={`${listboxId}-opt-${lang.code}`}
                    role="option"
                    aria-selected={lang.code === value}
                    type="button"
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => selectLanguage(lang)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-parchment transition ${
                      i === highlighted ? "bg-surface" : ""
                    }`}
                  >
                    <span>
                      {lang.name}
                      {lang.nativeName && lang.nativeName !== lang.name && (
                        <span className="ml-1.5 text-parchment-muted">{lang.nativeName}</span>
                      )}
                    </span>
                    {lang.code === value && <Check className="h-4 w-4 shrink-0 text-gold-500" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

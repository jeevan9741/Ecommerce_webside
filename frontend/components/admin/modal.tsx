"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
  size = "default",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "default" | "xl";
}) {
  // Escape to close, and lock background scroll while open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const panelSize =
    size === "xl"
      ? "h-[92vh] w-full max-w-[1200px] sm:h-[90vh] sm:w-[90vw]"
      : "max-h-[90vh] w-full max-w-lg sm:max-h-[85vh]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      <div
        className={`card relative flex flex-col overflow-hidden bg-ink-elevated !rounded-b-none sm:!rounded-b-2xl ${panelSize}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-5 py-4 sm:px-6">
          <h2 className="font-display truncate text-lg font-semibold text-parchment">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-parchment-muted transition hover:bg-surface-hover hover:text-parchment"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

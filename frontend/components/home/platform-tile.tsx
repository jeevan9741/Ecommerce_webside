import { PlayCircle } from "lucide-react";

/**
 * Neutral platform tile for the homepage demo cards: a generic play icon and the platform name as
 * plain text, in the academy's own colours. No brand logos, colours or lettering styles.
 */
export function PlatformTile({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-gold-500 to-gold-600 px-2 text-white ${className}`}
      aria-hidden="true"
    >
      <PlayCircle className="h-7 w-7 opacity-90" />
      <span className="text-center text-base font-bold leading-tight sm:text-lg">{name}</span>
    </span>
  );
}

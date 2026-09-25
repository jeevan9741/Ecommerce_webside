"use client";

import { useId, useMemo } from "react";
import { renderCardBack, renderCardFront, type PartnerCardArt } from "@/lib/partner-card/design";

export const CARD_LOGO_SRC = "/brand/card-logo.jpg";

/**
 * Live front + back preview, drawn from the same SVG builder the PNG/PDF export uses.
 * Re-renders on every change to `art`, so form edits show up immediately.
 */
export function PartnerCardPreview({
  art,
  watermark,
  className = "",
}: {
  art: PartnerCardArt;
  watermark?: string | null;
  className?: string;
}) {
  // SVG ids must be unique per document (the admin page can show a card next to the list).
  const prefix = `pc${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
  const [front, back] = useMemo(() => {
    const opts = { logoHref: CARD_LOGO_SRC, watermark, idPrefix: prefix };
    return [renderCardFront(art, opts), renderCardBack(art, opts)];
  }, [art, watermark, prefix]);

  return (
    <div className={`grid grid-cols-1 gap-5 sm:grid-cols-2 ${className}`}>
      <CardFace label="Front side" svg={front} />
      <CardFace label="Back side" svg={back} />
    </div>
  );
}

function CardFace({ label, svg }: { label: string; svg: string }) {
  return (
    <figure className="mx-auto w-full max-w-[340px]">
      <div
        className="aspect-[670/985] w-full overflow-hidden rounded-[18px] shadow-[0_24px_50px_-24px_rgba(17,28,128,0.55)] ring-1 ring-black/5 [&>svg]:h-full [&>svg]:w-full"
        // The markup comes from our own builder, which escapes every user-supplied value.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="mt-2 text-center text-xs font-semibold uppercase tracking-wider text-parchment-muted">
        {label}
      </figcaption>
    </figure>
  );
}

"use client";

import { useMemo } from "react";
import { renderCertificate, type CertificateArt } from "@/lib/certificate/design";

const LOGO_SRC = "/brand/card-logo.jpg";

/**
 * The certificate drawn from the same SVG builder the PDF uses, scaled to the container width so
 * it reads on a phone as well as a desktop.
 */
export function CertificatePreview({ art, watermark, className = "" }: { art: CertificateArt; watermark?: string | null; className?: string }) {
  const svg = useMemo(() => renderCertificate(art, { logoHref: LOGO_SRC, watermark }), [art, watermark]);
  return (
    <div
      className={`aspect-[297/210] w-full overflow-hidden rounded-xl bg-white shadow-[0_24px_50px_-24px_rgba(17,28,128,0.45)] ring-1 ring-black/5 [&>svg]:h-full [&>svg]:w-full ${className}`}
      // The markup comes from our own builder, which escapes every user-supplied value.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

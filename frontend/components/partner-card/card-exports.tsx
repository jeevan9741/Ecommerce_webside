"use client";

import { useState } from "react";
import { Download, FileDown, Loader2, Printer } from "lucide-react";
import { CARD_MM } from "@/lib/partner-card/design";

type Job = "front" | "back" | "pdf" | "print";

async function fetchExport(partnerId: string, file: string): Promise<Blob> {
  const res = await fetch(`/id-cards/${encodeURIComponent(partnerId)}/${file}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === "string" ? data.error : `Export failed (${res.status})`);
  }
  return res.blob();
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Prints both sides on one A4 sheet at true card size from the server's 300 DPI renders,
 * via a hidden iframe so the dashboard itself isn't reflowed for print.
 */
async function printCard(partnerId: string) {
  const [front, back] = await Promise.all([fetchExport(partnerId, "front.png"), fetchExport(partnerId, "back.png")]);
  const urls = [URL.createObjectURL(front), URL.createObjectURL(back)];
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${partnerId} — Partner ID Card</title><style>
    @page { size: A4 portrait; margin: 0; }
    html, body { margin: 0; }
    body { display: flex; justify-content: center; gap: 14mm; padding-top: 30mm; }
    figure { margin: 0; text-align: center; font: 600 8pt system-ui, sans-serif; color: #555; }
    img { display: block; width: ${CARD_MM.width}mm; height: ${CARD_MM.height}mm; outline: 0.2mm dashed #bbb; outline-offset: 1.5mm; }
    figcaption { margin-top: 4mm; letter-spacing: .1em; }
  </style></head><body>
    <figure><img src="${urls[0]}" alt="Front"><figcaption>FRONT</figcaption></figure>
    <figure><img src="${urls[1]}" alt="Back"><figcaption>BACK</figcaption></figure>
  </body></html>`);
  doc.close();

  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise((resolve) => img.addEventListener("load", resolve, { once: true }))
    )
  );
  const win = iframe.contentWindow!;
  win.addEventListener("afterprint", cleanup, { once: true });
  // Fallback for browsers that don't fire afterprint from an iframe.
  setTimeout(cleanup, 60_000);
  win.focus();
  win.print();
}

export function PartnerCardExports({
  partnerId,
  disabled,
  onError,
}: {
  partnerId: string;
  /** Exports are only offered once the card exists on the server. */
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<Job | null>(null);

  async function run(job: Job) {
    setBusy(job);
    try {
      if (job === "print") await printCard(partnerId);
      else if (job === "pdf") saveBlob(await fetchExport(partnerId, "card.pdf"), `${partnerId}-id-card.pdf`);
      else saveBlob(await fetchExport(partnerId, `${job}.png`), `${partnerId}-${job}.png`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Export failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const spin = (job: Job, Icon: typeof Download) =>
    busy === job ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />;

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <button type="button" onClick={() => run("front")} disabled={disabled || busy !== null} className="btn-gold btn-sm">
        {spin("front", Download)} Front PNG
      </button>
      <button type="button" onClick={() => run("back")} disabled={disabled || busy !== null} className="btn-gold btn-sm">
        {spin("back", Download)} Back PNG
      </button>
      <button type="button" onClick={() => run("pdf")} disabled={disabled || busy !== null} className="btn-outline btn-sm">
        {spin("pdf", FileDown)} Download PDF
      </button>
      <button type="button" onClick={() => run("print")} disabled={disabled || busy !== null} className="btn-outline btn-sm">
        {spin("print", Printer)} Print ID Card
      </button>
    </div>
  );
}

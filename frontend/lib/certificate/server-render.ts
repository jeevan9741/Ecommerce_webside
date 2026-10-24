// Server-only: rasterises the certificate SVG with resvg and places it on an A4 landscape PDF.
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import { FONT_FILES, loadLogo, withDpi } from "@/lib/partner-card/server-render";
import { CERT_MM, renderCertificate, type CertificateArt } from "./design";

/** Sharp in print, and keeps the PDF to a few hundred KB. */
const CERTIFICATE_DPI = 220;
const MM_TO_PT = 72 / 25.4;

/** resvg can't fetch remote images, so the signature is inlined as a data URL (or left out). */
export async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
    if (!/^image\/(png|jpeg)$/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderCertificatePng(art: CertificateArt, watermark: string | null, dpi = CERTIFICATE_DPI) {
  const svg = renderCertificate(art, { logoHref: await loadLogo(), watermark });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round((CERT_MM.width / 25.4) * dpi) },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Poppins" },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
  });
  return withDpi(resvg.render().asPng(), dpi);
}

/** One A4 landscape page, edge to edge — print at "Actual size" / 100%. */
export async function renderCertificatePdf(art: CertificateArt, watermark: string | null) {
  const png = await renderCertificatePng(art, watermark);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of Completion — ${art.courseTitle}`);
  pdf.setSubject(`${art.studentName} · ${art.certificateNo}`);
  pdf.setAuthor("E-Commerce Training Academy");
  pdf.setCreator("E-Commerce Training Academy");
  const width = CERT_MM.width * MM_TO_PT;
  const height = CERT_MM.height * MM_TO_PT;
  const page = pdf.addPage([width, height]);
  page.drawImage(await pdf.embedPng(png), { x: 0, y: 0, width, height });
  return pdf.save();
}

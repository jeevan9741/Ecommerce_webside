// Server-only: rasterises the card SVGs with resvg and lays them out on an A4 PDF.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CARD_MM, renderCardBack, renderCardFront, type PartnerCardArt } from "./design";

export const EXPORT_DPI = 300;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const FONT_FILES = ["Poppins-Medium", "Poppins-SemiBold", "Poppins-Bold", "Poppins-ExtraBold", "KaushanScript-Regular"].map(
  (name) => path.join(PUBLIC_DIR, "fonts", "card", `${name}.ttf`)
);

let logoDataUrl: Promise<string> | null = null;
function loadLogo() {
  logoDataUrl ??= readFile(path.join(PUBLIC_DIR, "brand", "card-logo.jpg")).then(
    (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`
  );
  return logoDataUrl;
}

const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/** CRC-32 for the PNG chunk we add below. */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserts a pHYs chunk after IHDR so printing apps size the image at its true DPI. */
function withDpi(png: Buffer, dpi: number) {
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from("pHYs", "ascii");
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 17);
  const ihdrEnd = 8 + 25; // signature + IHDR (length, type, 13 bytes data, crc)
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

export type CardSide = "front" | "back";

export async function renderCardPng(card: PartnerCardArt, side: CardSide, watermark: string | null, dpi = EXPORT_DPI) {
  const opts = { logoHref: await loadLogo(), watermark };
  const svg = side === "front" ? renderCardFront(card, opts) : renderCardBack(card, opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: mmToPx(CARD_MM.width, dpi) },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Poppins" },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
  });
  return withDpi(resvg.render().asPng(), dpi);
}

const MM_TO_PT = 72 / 25.4;

/**
 * A4 print sheet: front and back side by side at true card size, with crop marks and a
 * print-at-100% note, so the sheet can go straight to an office printer and be cut out.
 */
export async function renderCardPdf(card: PartnerCardArt, watermark: string | null) {
  const [front, back] = await Promise.all([
    renderCardPng(card, "front", watermark),
    renderCardPng(card, "back", watermark),
  ]);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Partner ID Card — ${card.partnerId}`);
  pdf.setAuthor("E-Commerce Training Academy");
  pdf.setCreator("E-Commerce Training Academy");
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const w = CARD_MM.width * MM_TO_PT;
  const h = CARD_MM.height * MM_TO_PT;
  const gap = 14 * MM_TO_PT;
  const left = (page.getWidth() - (w * 2 + gap)) / 2;
  const top = page.getHeight() - 42 * MM_TO_PT;
  const navy = rgb(0.07, 0.11, 0.5);
  const grey = rgb(0.35, 0.38, 0.45);

  page.drawText("E-Commerce Training Academy — Partner ID Card", { x: left, y: page.getHeight() - 22 * MM_TO_PT, size: 14, font: bold, color: navy });
  page.drawText(`${card.fullName} · ${card.partnerId}`, { x: left, y: page.getHeight() - 29 * MM_TO_PT, size: 10, font, color: grey });

  const images = await Promise.all([pdf.embedPng(front), pdf.embedPng(back)]);
  images.forEach((img, i) => {
    const x = left + i * (w + gap);
    const y = top - h;
    page.drawImage(img, { x, y, width: w, height: h });
    const label = i === 0 ? "FRONT" : "BACK";
    page.drawText(label, { x: x + (w - bold.widthOfTextAtSize(label, 8)) / 2, y: top + 10 * MM_TO_PT, size: 8, font: bold, color: grey });
    // Crop marks 3 mm outside each corner.
    const off = 3 * MM_TO_PT;
    const len = 5 * MM_TO_PT;
    const mark = { thickness: 0.4, color: rgb(0.2, 0.2, 0.2) };
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
      const sx = cx === x ? -1 : 1;
      const sy = cy === y ? -1 : 1;
      page.drawLine({ start: { x: cx + sx * off, y: cy }, end: { x: cx + sx * (off + len), y: cy }, ...mark });
      page.drawLine({ start: { x: cx, y: cy + sy * off }, end: { x: cx, y: cy + sy * (off + len) }, ...mark });
    }
  });

  const notes = [
    `Print at 100% / "Actual size" on A4. Each card is ${CARD_MM.width} × ${CARD_MM.height} mm (CR100), rendered at ${EXPORT_DPI} DPI.`,
    "Cut along the crop marks, then laminate the two sides back to back or print on PVC card stock.",
    `Verify this card at ${card.qrUrl.split("?")[0]}`,
  ];
  notes.forEach((line, i) =>
    page.drawText(line, { x: left, y: top - h - (16 + i * 6) * MM_TO_PT, size: 8.5, font, color: grey })
  );

  return pdf.save();
}

/**
 * Course completion certificate artwork as a plain SVG string. The same builder feeds the
 * dashboard preview (inline SVG, scales to any screen) and the server-side PDF (rasterised with
 * resvg), so what a student sees is exactly what prints. Pure string code — no DOM, no Node APIs.
 *
 * Coordinates are in tenths of a millimetre on A4 landscape (297 × 210 mm).
 */
import QRCode from "qrcode";
import { textWidth } from "@/lib/partner-card/design";

export const CERT_W = 2970;
export const CERT_H = 2100;
export const CERT_MM = { width: 297, height: 210 } as const;

const FONT = "Poppins";
const SCRIPT_FONT = "Kaushan Script";

const NAVY = "#111c80";
const BLUE = "#2563eb";
const YELLOW = "#ffd60a";
const GREY = "#4b5563";
const MUTED = "#6b7280";
const PAPER = "#fdfdfb";

export interface CertificateArt {
  certificateNo: string;
  studentName: string;
  courseTitle: string;
  /** ISO date. */
  completedAt: string;
  signatoryName: string;
  signatoryTitle: string;
  /** href for the signature image (a data URL on the server); null leaves the line blank. */
  signatureHref: string | null;
  /** Absolute URL encoded in the QR code. */
  verifyUrl: string;
}

export interface CertificateRenderOptions {
  /** href for the academy logo: a site path in the browser, a data URL on the server. */
  logoHref: string;
  /** Diagonal overlay, e.g. "REVOKED". */
  watermark?: string | null;
}

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** "4 October 2026", in UTC like the stored dates. */
export function formatCertificateDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

type Weight = 500 | 600 | 700 | 800;

/** Centred Poppins text that shrinks (then condenses) to fit `maxWidth`. */
function line(y: number, value: string, size: number, weight: Weight, fill: string, maxWidth: number, extra = "") {
  const natural = textWidth(value, weight, size);
  let fontSize = size;
  let fit = "";
  if (natural > maxWidth) {
    fontSize = Math.max(size * 0.7, (size * maxWidth) / natural);
    if (textWidth(value, weight, fontSize) > maxWidth) fit = ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`;
  }
  return `<text x="${CERT_W / 2}" y="${y}" font-family="${FONT}" font-weight="${weight}" font-size="${fontSize.toFixed(1)}" fill="${fill}" text-anchor="middle"${fit} ${extra}>${esc(value)}</text>`;
}

function label(x: number, y: number, value: string, anchor: "start" | "middle" | "end" = "start") {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="600" font-size="30" letter-spacing="4" fill="${MUTED}" text-anchor="${anchor}">${esc(value)}</text>`;
}

function value(x: number, y: number, text: string, size = 46, anchor: "start" | "middle" | "end" = "start") {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="700" font-size="${size}" fill="${NAVY}" text-anchor="${anchor}">${esc(text)}</text>`;
}

function qrCode(url: string, x: number, y: number, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const cell = size / (count + 4);
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) d += `M${(x + cell * (c + 2)).toFixed(2)} ${(y + cell * (r + 2)).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#0b0f2e" shape-rendering="crispEdges"/>`;
}

/** Corner ornament: an L of navy and yellow bars, mirrored per corner. */
function corner(x: number, y: number, sx: 1 | -1, sy: 1 | -1) {
  return `<g transform="translate(${x} ${y}) scale(${sx} ${sy})">
    <path d="M0 0h260v26H26v234H0z" fill="${NAVY}"/>
    <path d="M44 44h150v12H56v138H44z" fill="${YELLOW}"/>
  </g>`;
}

export function renderCertificate(c: CertificateArt, opts: CertificateRenderOptions) {
  // Kaushan Script is narrower than Poppins Bold; this keeps long names inside the frame.
  const nameSize = 150;
  const nameWidth = textWidth(c.studentName, 700, nameSize) * 0.9;
  const nameMax = 2150;
  const nameFit = nameWidth > nameMax ? ` textLength="${nameMax}" lengthAdjust="spacingAndGlyphs"` : "";

  const sigX = 2370;
  const signature = c.signatureHref
    ? `<image href="${esc(c.signatureHref)}" x="${sigX - 300}" y="1560" width="600" height="190" preserveAspectRatio="xMidYMax meet"/>`
    : "";

  const watermark = opts.watermark
    ? `<text x="${CERT_W / 2}" y="${CERT_H / 2 + 120}" font-family="${FONT}" font-weight="800" font-size="320" fill="#dc2626" fill-opacity="0.16" text-anchor="middle" transform="rotate(-18 ${CERT_W / 2} ${CERT_H / 2})">${esc(opts.watermark)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CERT_W} ${CERT_H}" width="${CERT_W}" height="${CERT_H}" role="img" aria-label="${esc(`Certificate of completion — ${c.studentName}, ${c.courseTitle}`)}">
  <rect width="${CERT_W}" height="${CERT_H}" fill="${PAPER}"/>
  <rect x="60" y="60" width="${CERT_W - 120}" height="${CERT_H - 120}" fill="none" stroke="${NAVY}" stroke-width="14"/>
  <rect x="105" y="105" width="${CERT_W - 210}" height="${CERT_H - 210}" fill="none" stroke="${BLUE}" stroke-width="4"/>
  ${corner(60, 60, 1, 1)}${corner(CERT_W - 60, 60, -1, 1)}${corner(60, CERT_H - 60, 1, -1)}${corner(CERT_W - 60, CERT_H - 60, -1, -1)}

  <image href="${esc(opts.logoHref)}" x="${CERT_W / 2 - 150}" y="150" width="300" height="300" preserveAspectRatio="xMidYMid meet"/>
  ${line(530, "E-COMMERCE TRAINING ACADEMY", 44, 700, NAVY, 2000, 'letter-spacing="10"')}

  ${line(700, "CERTIFICATE", 150, 800, NAVY, 2200, 'letter-spacing="24"')}
  ${line(790, "OF COMPLETION", 54, 600, BLUE, 2000, 'letter-spacing="22"')}
  <rect x="${CERT_W / 2 - 120}" y="830" width="240" height="10" fill="${YELLOW}"/>

  ${line(950, "This is to certify that", 46, 500, GREY, 2000)}
  <text x="${CERT_W / 2}" y="1125" font-family="${SCRIPT_FONT}" font-size="${nameSize}" fill="${NAVY}" text-anchor="middle"${nameFit}>${esc(c.studentName)}</text>
  <line x1="${CERT_W / 2 - 700}" y1="1170" x2="${CERT_W / 2 + 700}" y2="1170" stroke="${BLUE}" stroke-width="3"/>
  ${line(1265, "has successfully completed the course", 46, 500, GREY, 2000)}
  ${line(1395, c.courseTitle, 76, 700, NAVY, 2300)}

  ${label(300, 1690, "DATE OF COMPLETION")}
  ${value(300, 1750, formatCertificateDate(c.completedAt))}
  ${label(300, 1840, "CERTIFICATE ID")}
  ${value(300, 1900, c.certificateNo)}

  ${qrCode(c.verifyUrl, CERT_W / 2 - 130, 1580, 260)}
  ${label(CERT_W / 2, 1880, "SCAN TO VERIFY", "middle")}

  ${signature}
  <line x1="${sigX - 280}" y1="1765" x2="${sigX + 280}" y2="1765" stroke="${NAVY}" stroke-width="3"/>
  ${value(sigX, 1830, c.signatoryName, 46, "middle")}
  <text x="${sigX}" y="1885" font-family="${FONT}" font-weight="500" font-size="36" fill="${GREY}" text-anchor="middle">${esc(c.signatoryTitle)}</text>

  <text x="${CERT_W / 2}" y="1950" font-family="${FONT}" font-weight="500" font-size="26" fill="${MUTED}" text-anchor="middle">${esc(`Verify this certificate at ${c.verifyUrl}`)}</text>
  ${watermark}
</svg>`;
}

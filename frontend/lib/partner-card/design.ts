/**
 * Partner ID card artwork as plain SVG strings. The same builder feeds the live dashboard preview
 * (inline SVG in the browser) and the server-side PNG/PDF export (rasterised with resvg), so what
 * a partner sees is exactly what prints. Pure string code — no DOM, no Node APIs.
 *
 * Coordinates are in tenths of a millimetre on a 67 × 98.5 mm portrait badge (CR100), so the
 * 670 × 985 viewBox maps 1:1 onto the physical card.
 */
import QRCode from "qrcode";
import { POPPINS_WIDTHS, type PoppinsWeight } from "./metrics";

export const CARD_W = 670;
export const CARD_H = 985;
export const CARD_MM = { width: 67, height: 98.5 } as const;

export const FONT = "Poppins";
export const SCRIPT_FONT = "Kaushan Script";

export interface PartnerCardArt {
  fullName: string;
  partnerId: string;
  role: string;
  location: string;
  email: string;
  phone: string;
  /** ISO date string; null prints as "—" (not yet approved). */
  validFrom: string | null;
  photo: string | null;
  signature: string | null;
  /** Absolute URL encoded in the QR code. */
  qrUrl: string;
}

export interface RenderOptions {
  /** href for the academy logo: a site path in the browser, a data URL on the server. */
  logoHref: string;
  /** Prefix for element ids so several cards can share one HTML document. */
  idPrefix?: string;
  /** Diagonal overlay for cards that aren't active yet (e.g. "PENDING APPROVAL"). */
  watermark?: string | null;
}

// ---------- palette ----------

const NAVY = "#111c80";
const NAVY_TEXT = "#15208a";
const YELLOW = "#ffd60a";
const YELLOW_DEEP = "#f7b500";
const WHITE = "#ffffff";

// ---------- helpers ----------

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Advance width in px of `text` set in Poppins at `size`. Exact for ASCII (metrics come from the font files). */
export function textWidth(text: string, weight: PoppinsWeight, size: number) {
  const table = POPPINS_WIDTHS[weight];
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code <= 126 ? table[code - 32] : 620;
  }
  return (units / 1000) * size;
}

interface TextSpec {
  x: number;
  y: number;
  text: string;
  size: number;
  weight?: PoppinsWeight;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  /** Shrinks the font (down to minSize), then condenses the glyphs, so text never overflows. */
  maxWidth?: number;
  minSize?: number;
  extra?: string;
}

function text({ x, y, text: value, size, weight = 600, fill = NAVY_TEXT, anchor = "start", maxWidth, minSize, extra = "" }: TextSpec) {
  let fontSize = size;
  let lengthAttr = "";
  if (maxWidth) {
    const natural = textWidth(value, weight, size);
    if (natural > maxWidth) {
      fontSize = Math.max(minSize ?? size * 0.72, (size * maxWidth) / natural);
      if (textWidth(value, weight, fontSize) > maxWidth) {
        lengthAttr = ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`;
      }
    }
  }
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="${weight}" font-size="${fontSize.toFixed(2)}" fill="${fill}" text-anchor="${anchor}"${lengthAttr} ${extra}>${esc(value)}</text>`;
}

/** Fixed brand wordmarks: sized so the natural width lands on `width`, then pinned with textLength. */
function wordmark(x: number, y: number, value: string, width: number, weight: PoppinsWeight, fill: string, extra = "") {
  const size = (width / textWidth(value, weight, 100)) * 100;
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="${weight}" font-size="${size.toFixed(2)}" fill="${fill}" text-anchor="middle" textLength="${width}" lengthAdjust="spacingAndGlyphs" ${extra}>${esc(value)}</text>`;
}

function script(x: number, y: number, value: string, size: number, fill: string, extra = "") {
  return `<text x="${x}" y="${y}" font-family="${SCRIPT_FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(value)}</text>`;
}

/** DD-MM-YYYY in UTC, matching how the backend stores calendar days. */
export function formatCardDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

/** Indian 10-digit mobiles get the +91 prefix; anything else prints as entered. */
export function formatCardPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91 ${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2)}`;
  return phone.trim() || "—";
}

/** QR modules as one path, drawn inside a size × size square at (x, y) with a 2-module quiet zone. */
function qrCode(url: string, x: number, y: number, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const cell = size / (count + 4);
  const ox = x + cell * 2;
  const oy = y + cell * 2;
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) {
        d += `M${(ox + c * cell).toFixed(2)} ${(oy + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
      }
    }
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${WHITE}"/><path d="${d}" fill="#0b0f2e" shape-rendering="crispEdges"/>`;
}

/** A 24-unit icon glyph placed with its top-left at (x, y) and scaled to `size`. */
function icon(glyph: string, x: number, y: number, size: number, color: string) {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph.replaceAll("currentColor", color)}</g>`;
}

const GLYPH = {
  user: `<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="currentColor"/>`,
  briefcase: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>`,
  pin: `<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 17h2"/>`,
  phone: `<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>`,
  cap: `<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>`,
  play: `<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8v5l4-2.5z" fill="currentColor"/><path d="M8 21h8M12 17v4"/>`,
  certificate: `<rect x="4" y="3" width="14" height="17" rx="2"/><path d="M8 8h6M8 12h6"/><circle cx="17" cy="17" r="3"/><path d="M15.5 19.5 15 23l2-1 2 1-.5-3.5"/>`,
  headset: `<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 2-2 3-5 3"/>`,
  handshake: `<path d="M2 11l4-4 4 2 3-2 3 1 4-1 2 4-3 3M6 7l-4 6 3 3M9 15l2 2M11 13l3 3M13 11l3 3M14.5 17.5 16 19"/><path d="M5 16l3 3 2-1 2 2 2-1"/>`,
  rocket: `<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 11l4 4M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5z"/><circle cx="15" cy="9" r="1.6"/><path d="M9 11H5l3-3h3M13 15v4l3-3v-3"/>`,
};

function checkBullet(cx: number, cy: number, r: number) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1e9e45"/><path d="M${cx - r * 0.45} ${cy + r * 0.02} l${r * 0.32} ${r * 0.33} l${r * 0.6} ${-r * 0.62}" fill="none" stroke="${WHITE}" stroke-width="${r * 0.3}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Marketplace strip (text-built marks, so nothing depends on third-party image files). */
function marketplaces(x: number, y: number, w: number, h: number, darkAmazon: boolean) {
  const seg = w / 3;
  const cy = y + h / 2;
  const amazonX = x + seg / 2;
  const flipX = x + seg * 1.5;
  const meeshoX = x + seg * 2.5;
  const amazon = darkAmazon
    ? `<rect x="${amazonX - seg * 0.42}" y="${y + 9}" width="${seg * 0.84}" height="${h - 18}" rx="8" fill="#101a38"/>
       ${wordmark(amazonX, cy + 4, "amazon", seg * 0.6, 700, WHITE)}
       <path d="M${amazonX - seg * 0.22} ${cy + 10} q${seg * 0.2} ${9} ${seg * 0.4} ${-1}" fill="none" stroke="#ff9900" stroke-width="3" stroke-linecap="round"/>
       <path d="M${amazonX + seg * 0.15} ${cy + 6} l${seg * 0.05} ${3} l${-seg * 0.05} ${2}" fill="none" stroke="#ff9900" stroke-width="2.6" stroke-linecap="round"/>`
    : `${wordmark(amazonX, cy + 4, "amazon", seg * 0.66, 700, "#111111")}
       <path d="M${amazonX - seg * 0.26} ${cy + 11} q${seg * 0.24} ${10} ${seg * 0.46} ${-1}" fill="none" stroke="#ff9900" stroke-width="3.4" stroke-linecap="round"/>
       <path d="M${amazonX + seg * 0.16} ${cy + 6} l${seg * 0.06} ${3.5} l${-seg * 0.06} ${2.5}" fill="none" stroke="#ff9900" stroke-width="2.8" stroke-linecap="round"/>`;
  const flipkart = `
    <g transform="translate(${flipX - seg * 0.1} ${cy + 8}) skewX(-12)">${wordmark(0, 0, "Flipkart", seg * 0.56, 700, "#2874f0")}</g>
    <rect x="${flipX + seg * 0.22}" y="${cy - 15}" width="24" height="28" rx="4" fill="${YELLOW}"/>
    <g transform="translate(${flipX + seg * 0.22 + 12} ${cy + 8}) skewX(-10)"><text x="0" y="0" font-family="${FONT}" font-weight="800" font-size="24" fill="#2874f0" text-anchor="middle">f</text></g>`;
  const meesho = `
    <rect x="${meeshoX - seg * 0.38}" y="${y + 7}" width="${seg * 0.76}" height="${h - 14}" rx="8" fill="#e5237a"/>
    <text x="${meeshoX}" y="${cy + 4}" font-family="${FONT}" font-weight="700" font-size="${h * 0.48}" fill="${WHITE}" text-anchor="middle">m</text>
    ${wordmark(meeshoX, y + h - 12, "meesho", seg * 0.42, 600, WHITE)}`;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${WHITE}" filter="url(#{P}soft)"/>
    ${amazon}
    <line x1="${x + seg}" y1="${y + 10}" x2="${x + seg}" y2="${y + h - 10}" stroke="#cfd6ea" stroke-width="2"/>
    ${flipkart}
    <line x1="${x + seg * 2}" y1="${y + 10}" x2="${x + seg * 2}" y2="${y + h - 10}" stroke="#cfd6ea" stroke-width="2"/>
    ${meesho}`;
}

/** Circular academy logo with the yellow ring used on both sides. */
function logoBadge(cx: number, cy: number, r: number, logoHref: string) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#0c1466" opacity="0.35" filter="url(#{P}soft)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${YELLOW}"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 7}" fill="${WHITE}"/>
    <clipPath id="{P}logo-${cx}"><circle cx="${cx}" cy="${cy}" r="${r - 10}"/></clipPath>
    <image href="${esc(logoHref)}" x="${cx - (r - 8)}" y="${cy - (r - 8)}" width="${(r - 8) * 2}" height="${(r - 8) * 2}" clip-path="url(#{P}logo-${cx})" preserveAspectRatio="xMidYMid slice"/>`;
}

function defs() {
  return `<defs>
    <clipPath id="{P}card"><rect width="${CARD_W}" height="${CARD_H}" rx="30"/></clipPath>
    <linearGradient id="{P}blue" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#1424a8"/><stop offset="0.55" stop-color="#2335d6"/><stop offset="1" stop-color="#5b2de6"/>
    </linearGradient>
    <linearGradient id="{P}blueFoot" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2cc4"/><stop offset="1" stop-color="#101c96"/>
    </linearGradient>
    <linearGradient id="{P}navy" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2233c4"/><stop offset="1" stop-color="#0f1a82"/>
    </linearGradient>
    <linearGradient id="{P}yellow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe45c"/><stop offset="1" stop-color="${YELLOW_DEEP}"/>
    </linearGradient>
    <linearGradient id="{P}sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d9bff"/><stop offset="1" stop-color="#1c6fe0"/>
    </linearGradient>
    <filter id="{P}soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0a1250" flood-opacity="0.3"/>
    </filter>
    <filter id="{P}textShadow" x="-10%" y="-20%" width="120%" height="150%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="1.5" flood-color="#070d4a" flood-opacity="0.55"/>
    </filter>
  </defs>`;
}

function watermarkLayer(label: string | null | undefined) {
  if (!label) return "";
  return `<g transform="rotate(-38 ${CARD_W / 2} ${CARD_H / 2})" opacity="0.8">
    <rect x="-80" y="${CARD_H / 2 - 42}" width="${CARD_W + 160}" height="84" fill="#dc2626" opacity="0.82"/>
    ${text({ x: CARD_W / 2, y: CARD_H / 2 + 15, text: label, size: 44, weight: 800, fill: WHITE, anchor: "middle", maxWidth: 520 })}
  </g>`;
}

function wrap(body: string, opts: RenderOptions, title: string) {
  const prefix = opts.idPrefix ?? "pc-";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" role="img" aria-label="${esc(title)}">
  ${defs()}
  <g clip-path="url(#{P}card)">
    <rect width="${CARD_W}" height="${CARD_H}" fill="${WHITE}"/>
    ${body}
    ${watermarkLayer(opts.watermark)}
  </g>
  </svg>`;
  return svg.replaceAll("{P}", prefix);
}

/** Header wordmark shared by both sides, centred on cx. */
function academyTitle(cx: number, top: number, scale: number) {
  return `
    ${wordmark(cx, top, "E-COMMERCE", 356 * scale, 800, WHITE, `filter="url(#{P}textShadow)"`)}
    ${wordmark(cx, top + 44 * scale, "TRAINING ACADEMY", 364 * scale, 800, YELLOW, `filter="url(#{P}textShadow)"`)}
    ${wordmark(cx, top + 84 * scale, "Learn  |  Sell  |  Grow", 260 * scale, 700, WHITE)}`;
}

// ---------- front ----------

export function renderCardFront(card: PartnerCardArt, opts: RenderOptions) {
  const name = card.fullName.trim().toUpperCase() || "YOUR NAME";
  const rows: [keyof typeof GLYPH, string, string][] = [
    ["user", "Partner ID", card.partnerId],
    ["briefcase", "Role", card.role],
    ["pin", "Location", card.location || "—"],
    ["calendar", "Valid From", formatCardDate(card.validFrom)],
  ];

  const photo = card.photo
    ? `<image href="${esc(card.photo)}" x="173" y="307" width="275" height="270" preserveAspectRatio="xMidYMid slice" clip-path="url(#{P}photo)"/>`
    : `<g clip-path="url(#{P}photo)" fill="#ffffff" opacity="0.9">
         <circle cx="310.5" cy="415" r="58"/>
         <path d="M190 590c10-70 60-105 120.5-105S421 520 431 590z"/>
       </g>`;

  const body = `
    <!-- header: yellow/purple swoosh layers under the blue panel -->
    <path d="M0 0H670V396C600 414 520 400 450 390C330 374 240 398 150 440C95 466 45 490 0 508Z" fill="url(#{P}yellow)"/>
    <path d="M0 0H670V388C600 405 520 391 450 381C330 365 240 389 150 431C95 457 45 481 0 499Z" fill="#6d2ae8"/>
    <path d="M0 0H670V378C600 395 520 381 450 371C330 355 240 379 150 421C95 447 45 471 0 489Z" fill="url(#{P}blue)"/>
    <path d="M0 250C12 150 62 64 150 0H200C104 56 44 140 22 262Z" fill="url(#{P}yellow)"/>
    <path d="M670 0V120C640 70 600 30 548 0Z" fill="#7a3cf5" opacity="0.55"/>
    <circle cx="610" cy="60" r="90" fill="#ffffff" opacity="0.05"/>
    <circle cx="80" cy="420" r="60" fill="#ffffff" opacity="0.04"/>

    <!-- lanyard slot -->
    <rect x="276" y="20" width="118" height="22" rx="11" fill="#ffffff" opacity="0.92"/>

    ${logoBadge(148, 150, 118, opts.logoHref)}
    ${academyTitle(468, 118, 1)}
    ${marketplaces(270, 222, 376, 56, false)}

    <!-- taglines -->
    <g fill="${WHITE}">
      <path d="M14 322 42 296 70 322" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M23 318V350H37V334H47V350H61V318L42 301Z"/>
    </g>
    <g transform="rotate(-13 110 320)">
      ${script(70, 312, "Work From", 25, WHITE, `filter="url(#{P}textShadow)"`)}
      ${script(84, 342, "Home", 25, WHITE, `filter="url(#{P}textShadow)"`)}
    </g>
    <g transform="rotate(-11 560 330)">
      ${script(486, 318, "Start Your", 24, YELLOW, `filter="url(#{P}textShadow)"`)}
      ${script(476, 348, "Online Business", 24, YELLOW, `filter="url(#{P}textShadow)"`)}
    </g>
    <path d="M478 388C556 384 614 362 650 324" fill="none" stroke="${YELLOW}" stroke-width="4" stroke-linecap="round"/>
    <path d="M637 324 651 321 650 337" fill="none" stroke="${YELLOW}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- photo -->
    <rect x="165" y="299" width="291" height="286" rx="22" fill="url(#{P}yellow)" filter="url(#{P}soft)"/>
    <clipPath id="{P}photo"><rect x="173" y="307" width="275" height="270" rx="16"/></clipPath>
    <rect x="173" y="307" width="275" height="270" rx="16" fill="url(#{P}sky)"/>
    ${photo}

    <!-- QR -->
    <rect x="487" y="401" width="146" height="180" rx="12" fill="${WHITE}" stroke="${YELLOW}" stroke-width="5" filter="url(#{P}soft)"/>
    ${qrCode(card.qrUrl, 496, 408, 128)}
    <path d="M492 536H628V568A9 9 0 0 1 619 577H501A9 9 0 0 1 492 568Z" fill="${NAVY}"/>
    ${text({ x: 560, y: 553, text: "Scan for", size: 14.5, weight: 600, fill: WHITE, anchor: "middle" })}
    ${text({ x: 560, y: 570, text: "Partner Details", size: 14.5, weight: 600, fill: WHITE, anchor: "middle" })}

    <!-- name banner -->
    <path d="M34 590H50L80 654H64Z" fill="url(#{P}yellow)"/>
    <path d="M636 590H620L590 654H606Z" fill="url(#{P}yellow)"/>
    <path d="M78 648H592L572 694H98Z" fill="url(#{P}yellow)" filter="url(#{P}soft)"/>
    <path d="M52 590H618L590 652H80Z" fill="url(#{P}navy)" filter="url(#{P}soft)"/>
    ${text({ x: 335, y: 641, text: name, size: 58, weight: 800, fill: WHITE, anchor: "middle", maxWidth: 480, minSize: 34, extra: `filter="url(#{P}textShadow)"` })}
    ${wordmark(335, 682, "BUSINESS PARTNER", 318, 800, "#0d1670")}

    <!-- details -->
    ${rows
      .map(([glyph, label, value], i) => {
        const cy = 720 + i * 35;
        return `
          <rect x="34" y="${cy - 17}" width="34" height="34" rx="8" fill="url(#{P}navy)"/>
          ${icon(GLYPH[glyph], 40, cy - 11, 22, WHITE)}
          ${text({ x: 88, y: cy + 7, text: label, size: 20.5, weight: 600 })}
          ${text({ x: 220, y: cy + 7, text: ":", size: 20.5, weight: 600 })}
          ${text({ x: 240, y: cy + 7, text: value, size: 20.5, weight: 600, maxWidth: 370, minSize: 15 })}`;
      })
      .join("")}

    <!-- footer -->
    <path d="M0 872C120 850 250 852 360 858C480 864 590 830 670 776V985H0Z" fill="url(#{P}yellow)"/>
    <path d="M0 884C120 862 250 864 360 870C480 876 590 842 670 788V985H0Z" fill="#6d2ae8"/>
    <path d="M0 892C120 870 250 872 360 878C480 884 590 850 670 796V985H0Z" fill="url(#{P}blueFoot)"/>
    <path d="M0 958C90 930 190 920 300 930V985H0Z" fill="#0c1678" opacity="0.5"/>
    <g transform="rotate(-10 180 930)">
      ${script(48, 928, "Together We Build", 26, YELLOW, `filter="url(#{P}textShadow)"`)}
      ${script(62, 960, "Successful Businesses...", 26, YELLOW, `filter="url(#{P}textShadow)"`)}
    </g>
    <path d="M24 944l3.8 7.6 8.4 1.2-6 5.9 1.4 8.4-7.6-4-7.6 4 1.4-8.4-6-5.9 8.4-1.2z" fill="${WHITE}"/>

    <rect x="336" y="848" width="318" height="120" rx="16" fill="${WHITE}" filter="url(#{P}soft)"/>
    ${(
      [
        ["cap", "#7b2ff7", "Expert", "Guidance"],
        ["play", "#1f9d3a", "Live", "Training"],
        ["certificate", "#f26b1d", "Certificate", "Provided"],
        ["headset", "#e8246f", "Lifetime", "Support"],
      ] as const
    )
      .map(([glyph, color, l1, l2], i) => {
        const cx = 336 + 39.75 + i * 79.5;
        return `
          ${i > 0 ? `<line x1="${336 + i * 79.5}" y1="862" x2="${336 + i * 79.5}" y2="954" stroke="#d7dcef" stroke-width="1.5"/>` : ""}
          <circle cx="${cx}" cy="887" r="27" fill="${color}" stroke="${WHITE}" stroke-width="3" filter="url(#{P}soft)"/>
          ${icon(GLYPH[glyph], cx - 14, 873, 28, WHITE)}
          ${text({ x: cx, y: 934, text: l1, size: 13.5, weight: 600, anchor: "middle", maxWidth: 76 })}
          ${text({ x: cx, y: 952, text: l2, size: 13.5, weight: 600, anchor: "middle", maxWidth: 76 })}`;
      })
      .join("")}
  `;

  return wrap(body, opts, `Partner ID card front — ${card.fullName}`);
}

// ---------- back ----------

const DESCRIPTION = [
  "This ID confirms that the above-mentioned person is an",
  "authorized Business/Referral Partner of E-Commerce",
  "Training Academy for promoting the Academy's",
  "training programs.",
];

const BENEFITS = ["Referral-based Commission", "Marketing Support", "Training Information", "Partner Support"];
const WHY_JOIN = [
  "Investment Opportunity",
  "Learn & Earn",
  "Flexible Work from Home",
  "Lifetime Support",
  "Growth with Digital India",
];
const NOTICE: string[][] = [
  ["This ID does not represent employment with the Academy."],
  ["Valid only for successfully verified enrollments as per", "Academy terms."],
  ["Do not make false promises or misleading information."],
];

function sectionBox(x: number, y: number, w: number, h: number, title: string, glyph: keyof typeof GLYPH) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#f6f8ff" stroke="#2a47d6" stroke-width="2"/>
    <path d="M${x + 44} ${y - 12}H${x + w - 4}L${x + w - 18} ${y + 24}H${x + 44}Z" fill="url(#{P}navy)"/>
    ${wordmark(x + 44 + (w - 48) / 2 + 12, y + 14, title, Math.min(w - 110, textWidth(title, 800, 19)), 800, YELLOW)}
    <circle cx="${x + 30}" cy="${y + 4}" r="33" fill="${YELLOW}" filter="url(#{P}soft)"/>
    <circle cx="${x + 30}" cy="${y + 4}" r="28" fill="${WHITE}"/>
    <circle cx="${x + 30}" cy="${y + 4}" r="25" fill="url(#{P}navy)"/>
    ${icon(GLYPH[glyph], x + 16, y - 10, 28, WHITE)}`;
}

function signatureMark(card: PartnerCardArt) {
  if (card.signature) {
    return `<image href="${esc(card.signature)}" x="455" y="770" width="152" height="58" preserveAspectRatio="xMidYMid meet"/>`;
  }
  // Default hand-drawn mark, in the spirit of an ink signature.
  return `<path d="M468 822c10-22 22-40 30-44 8-4 4 22-4 34-6 9 12-18 22-22 8-3 2 14 6 14s10-14 16-14 2 12 8 12 12-12 18-12 4 10 10 10c8 0 16-6 30-8M486 800c20 2 60 0 100-8" fill="none" stroke="${WHITE}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function renderCardBack(card: PartnerCardArt, opts: RenderOptions) {
  const contact: [keyof typeof GLYPH, string][] = [
    ["phone", formatCardPhone(card.phone)],
    ["pin", card.location || "—"],
    ["mail", card.email || "—"],
  ];

  const body = `
    <!-- header -->
    <path d="M0 0H670V214C560 222 460 228 300 230C180 232 80 238 0 252Z" fill="url(#{P}yellow)"/>
    <path d="M0 0H670V206C560 214 460 220 300 222C180 224 80 230 0 244Z" fill="#6d2ae8"/>
    <path d="M0 0H670V198C560 206 460 212 300 214C180 216 80 222 0 236Z" fill="url(#{P}blue)"/>
    <path d="M0 200C8 120 50 50 118 0H160C88 50 40 120 22 212Z" fill="url(#{P}yellow)"/>
    <path d="M470 0H560C610 14 648 40 670 72V118C636 62 566 20 470 0Z" fill="url(#{P}yellow)"/>
    <circle cx="600" cy="150" r="80" fill="#ffffff" opacity="0.05"/>

    <rect x="276" y="20" width="118" height="22" rx="11" fill="#ffffff" opacity="0.92"/>

    ${logoBadge(126, 118, 98, opts.logoHref)}
    ${academyTitle(440, 108, 1)}

    <!-- heading ribbon -->
    <path d="M76 214H594L612 236L594 258H76L58 236Z" fill="url(#{P}yellow)" filter="url(#{P}soft)"/>
    <path d="M52 212H70L46 236L70 260H52L28 236Z" fill="${NAVY}"/>
    <path d="M618 212H600L624 236L600 260H618L642 236Z" fill="${NAVY}"/>
    ${wordmark(335, 247, "AUTHORIZED BUSINESS PARTNER", 496, 800, "#0d1670")}

    <!-- description -->
    ${DESCRIPTION.map((line, i) => text({ x: 32, y: 292 + i * 23, text: line, size: 18.5, weight: 500, maxWidth: 606 })).join("")}

    <!-- benefits / why join -->
    ${sectionBox(28, 392, 318, 216, "PARTNER BENEFITS", "handshake")}
    ${BENEFITS.map(
      (item, i) => `${checkBullet(60, 458 + i * 33, 11)}${text({ x: 82, y: 465 + i * 33, text: item, size: 18, weight: 600, maxWidth: 252 })}`
    ).join("")}
    ${sectionBox(360, 392, 286, 216, "WHY JOIN?", "rocket")}
    ${WHY_JOIN.map(
      (item, i) => `${checkBullet(390, 452 + i * 30, 10.5)}${text({ x: 410, y: 458 + i * 30, text: item, size: 16, weight: 500, maxWidth: 228 })}`
    ).join("")}

    <!-- important -->
    <rect x="28" y="626" width="617" height="128" rx="12" fill="#e9f2ff" stroke="#6f9cf0" stroke-width="2"/>
    <path d="M70 628H222L206 656H70Z" fill="#dc1f2e"/>
    <circle cx="56" cy="640" r="24" fill="#dc1f2e" stroke="${WHITE}" stroke-width="4" filter="url(#{P}soft)"/>
    <rect x="53" y="626" width="6" height="18" rx="3" fill="${WHITE}"/>
    <circle cx="56" cy="651" r="3.6" fill="${WHITE}"/>
    ${text({ x: 90, y: 649, text: "IMPORTANT", size: 17, weight: 800, fill: WHITE })}
    ${(() => {
      let y = 681;
      return NOTICE.map((lines) =>
        lines
          .map((line, j) => {
            const out = `${j === 0 ? `<circle cx="72" cy="${y - 5}" r="3" fill="${NAVY_TEXT}"/>` : ""}${text({ x: 84, y, text: line, size: 15.5, weight: 500, maxWidth: 548 })}`;
            y += 21;
            return out;
          })
          .join("")
      ).join("");
    })()}

    <!-- contact band + footer -->
    <path d="M0 768H670V985H0Z" fill="url(#{P}blueFoot)"/>
    ${contact
      .map(([glyph, value], i) => {
        const cy = 792 + i * 30;
        return `
          <rect x="32" y="${cy - 13}" width="26" height="26" rx="6" fill="${WHITE}"/>
          ${icon(GLYPH[glyph], 36, cy - 9, 18, "#1b2cc4")}
          ${text({ x: 72, y: cy + 6, text: value, size: 17, weight: 500, fill: WHITE, maxWidth: 312, minSize: 12 })}`;
      })
      .join("")}
    <line x1="401" y1="780" x2="401" y2="868" stroke="${WHITE}" stroke-opacity="0.55" stroke-width="2"/>
    ${signatureMark(card)}
    ${text({ x: 531, y: 856, text: "Authorized Signature", size: 17, weight: 500, fill: WHITE, anchor: "middle" })}

    <path d="M0 884C80 872 170 872 250 894C290 906 312 940 318 985H0Z" fill="url(#{P}yellow)"/>
    <path d="M0 884C80 872 170 872 250 894C290 906 312 940 318 985" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="3"/>
    <g transform="rotate(-11 130 935)">
      ${script(34, 932, "Your Growth", 31, "#0d1670")}
      ${script(70, 968, "Our Mission", 31, "#0d1670")}
    </g>
    ${marketplaces(284, 892, 370, 74, true)}
  `;

  return wrap(body, opts, `Partner ID card back — ${card.fullName}`);
}

/** Standalone QR code SVG (for the on-screen "View QR" dialog). */
export function renderQrSvg(url: string, size = 256) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%" role="img" aria-label="Partner QR code">${qrCode(url, 0, 0, size)}</svg>`;
}

/**
 * Course completion certificate artwork as a plain SVG string. The same builder feeds the
 * dashboard preview (inline SVG, scales to any screen) and the server-side PDF (rasterised with
 * resvg), so what a student sees is exactly what prints. Pure string code — no DOM, no Node APIs.
 *
 * Coordinates are in tenths of a millimetre on A4 landscape (297 × 210 mm). Royal blue, white,
 * yellow and gold: a blue frame with gold ribbons around a white centre, the academy header on
 * top, a "course completed" medal on the left and the QR verification panel on the right.
 */
import QRCode from "qrcode";
import { textWidth } from "@/lib/partner-card/design";

export const CERT_W = 2970;
export const CERT_H = 2100;
export const CERT_MM = { width: 297, height: 210 } as const;

const FONT = "Poppins";
const SCRIPT_FONT = "Kaushan Script";

const ROYAL = "#1638c4";
const DEEP = "#0a1f8f";
const PANEL = "#0d27a3";
const INK = "#0b1a5e";
const YELLOW = "#ffd400";
const GOLD = "#e8b10c";
const WHITE = "#ffffff";

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

interface TextOpts {
  weight?: Weight;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  /** Shrinks the font (to 70%), then condenses the glyphs, so the text never overflows. */
  maxWidth?: number;
  letterSpacing?: number;
  font?: string;
  extra?: string;
}

function fitSize(value: string, size: number, weight: Weight, maxWidth: number | undefined, letterSpacing = 0, minFactor = 0.7) {
  if (!maxWidth) return { size, fit: "" };
  const width = (s: number) => textWidth(value, weight, s) + letterSpacing * value.length;
  if (width(size) <= maxWidth) return { size, fit: "" };
  const shrunk = Math.max(size * minFactor, (size * maxWidth) / width(size));
  return { size: shrunk, fit: width(shrunk) > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : "" };
}

function text(x: number, y: number, value: string, size: number, o: TextOpts = {}) {
  const weight = o.weight ?? 600;
  const { size: fontSize, fit } = fitSize(value, size, weight, o.maxWidth, o.letterSpacing);
  const spacing = o.letterSpacing ? ` letter-spacing="${o.letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" font-family="${o.font ?? FONT}" font-weight="${weight}" font-size="${fontSize.toFixed(1)}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "middle"}"${spacing}${fit} ${o.extra ?? ""}>${esc(value)}</text>`;
}

/** Cuts `value` at a word boundary and adds "…" so it fits `maxWidth` at `size`. */
function truncateToFit(value: string, size: number, weight: Weight, maxWidth: number) {
  if (textWidth(value, weight, size) <= maxWidth) return value;
  const words = value.split(" ");
  while (words.length > 1 && textWidth(`${words.join(" ")}…`, weight, size) > maxWidth) words.pop();
  let cut = `${words.join(" ").replace(/[,;:\-–—]+$/, "")}…`;
  while (cut.length > 2 && textWidth(cut, weight, size) > maxWidth) cut = `${cut.slice(0, -2)}…`;
  return cut;
}

/**
 * Splits a long value into at most two balanced lines when it won't fit on one at `minSize`.
 * Returns the lines and the font size that fits them.
 */
function wrapToFit(value: string, size: number, weight: Weight, maxWidth: number, minSize: number) {
  const oneLine = Math.min(size, (size * maxWidth) / textWidth(value, weight, size));
  if (oneLine >= minSize || !value.includes(" ")) return { lines: [value], size: Math.max(oneLine, minSize) };
  const words = value.split(" ");
  let best = { lines: [value], worst: Infinity };
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const worst = Math.max(...lines.map((l) => textWidth(l, weight, size)));
    if (worst < best.worst) best = { lines, worst };
  }
  return { lines: best.lines, size: Math.min(size, (size * maxWidth) / best.worst) };
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
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${WHITE}"/><path d="${d}" fill="#0b0f2e" shape-rendering="crispEdges"/>`;
}

const DEFS = `<defs>
    <linearGradient id="cert-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset="0.35" stop-color="#f7c600"/><stop offset="0.7" stop-color="#d79b06"/><stop offset="1" stop-color="#fbe27a"/>
    </linearGradient>
    <linearGradient id="cert-gold-v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0a0"/><stop offset="0.45" stop-color="#f9cc16"/><stop offset="1" stop-color="#d9a00a"/>
    </linearGradient>
    <linearGradient id="cert-yellow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe55c"/><stop offset="1" stop-color="#ffc800"/>
    </linearGradient>
    <linearGradient id="cert-blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f47e0"/><stop offset="0.55" stop-color="${ROYAL}"/><stop offset="1" stop-color="${DEEP}"/>
    </linearGradient>
    <linearGradient id="cert-panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1638c4"/><stop offset="1" stop-color="${PANEL}"/>
    </linearGradient>
    <radialGradient id="cert-paper" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2fb"/>
    </radialGradient>
    <clipPath id="cert-logo-clip"><circle cx="0" cy="0" r="188"/></clipPath>
  </defs>`;

/** Laurel branch: leaves along an arc from the bottom to the top of one side (`side` -1 = left). */
function laurel(cx: number, cy: number, r: number, side: 1 | -1, leaves: number, leaf: number, fill: string, from = 245, to = 110) {
  let out = "";
  for (let i = 0; i < leaves; i++) {
    const deg = from - (i * (from - to)) / (leaves - 1);
    const theta = side === -1 ? deg : 180 - deg;
    const rad = (theta * Math.PI) / 180;
    const x = cx + Math.cos(rad) * r;
    const y = cy - Math.sin(rad) * r;
    const rot = -theta + (side === -1 ? 25 : -25);
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(leaf * 0.42).toFixed(1)}" ry="${leaf.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}"/>`;
  }
  return out;
}

/** The "course completed" medal: gold wreath, navy disc, mortarboard, stars and ribbon tails. */
function medal(cx: number, cy: number) {
  const cap = `<g transform="translate(${cx} ${cy - 62})">
      <path d="M-78 0 L0 -36 L78 0 L0 36 Z" fill="${WHITE}"/>
      <path d="M-46 16 V46 Q0 70 46 46 V16 L0 36 Z" fill="${WHITE}"/>
      <path d="M62 8 V52" stroke="${YELLOW}" stroke-width="7"/><circle cx="62" cy="58" r="10" fill="${YELLOW}"/>
    </g>`;
  const star = (x: number) => `<path transform="translate(${x} ${cy + 108}) scale(1.1)" d="M0 -12 L3.5 -4 L12 -3.7 L5.5 2 L7.4 10.5 L0 6 L-7.4 10.5 L-5.5 2 L-12 -3.7 L-3.5 -4 Z" fill="${YELLOW}"/>`;
  return `<g>
    <path d="M${cx - 92} ${cy + 120} L${cx - 150} ${cy + 290} L${cx - 96} ${cy + 262} L${cx - 70} ${cy + 316} L${cx - 22} ${cy + 168} Z" fill="url(#cert-gold-v)"/>
    <path d="M${cx + 92} ${cy + 120} L${cx + 150} ${cy + 290} L${cx + 96} ${cy + 262} L${cx + 70} ${cy + 316} L${cx + 22} ${cy + 168} Z" fill="url(#cert-gold-v)"/>
    ${laurel(cx, cy, 192, 1, 8, 30, GOLD)}${laurel(cx, cy, 192, -1, 8, 30, GOLD)}
    <circle cx="${cx}" cy="${cy}" r="172" fill="url(#cert-gold)"/>
    <circle cx="${cx}" cy="${cy}" r="156" fill="${DEEP}"/>
    <circle cx="${cx}" cy="${cy}" r="146" fill="none" stroke="${GOLD}" stroke-width="4"/>
    ${cap}
    ${text(cx, cy + 40, "COURSE", 56, { weight: 800, fill: WHITE, maxWidth: 230 })}
    ${text(cx, cy + 88, "COMPLETED", 40, { weight: 800, fill: YELLOW, maxWidth: 236 })}
    ${star(cx - 34)}${star(cx)}${star(cx + 34)}
  </g>`;
}

/** Yellow disc with a small navy glyph, for the left panel's feature list. */
function featureIcon(kind: "chart" | "play" | "certificate" | "support", cx: number, cy: number) {
  const g: Record<typeof kind, string> = {
    chart: `<path d="M-22 22 H24 M-18 18 V2 M-6 18 V-8 M6 18 V-2 M18 18 V-16" stroke="${DEEP}" stroke-width="8" stroke-linecap="round" fill="none"/>`,
    play: `<circle r="24" fill="none" stroke="${DEEP}" stroke-width="6"/><path d="M-8 -12 L12 0 L-8 12 Z" fill="${DEEP}"/>`,
    certificate: `<rect x="-20" y="-24" width="34" height="44" rx="4" fill="none" stroke="${DEEP}" stroke-width="6"/><path d="M-12 -12 H6 M-12 -2 H6" stroke="${DEEP}" stroke-width="5"/><circle cx="14" cy="14" r="10" fill="${DEEP}"/>`,
    support: `<path d="M-22 8 V-2 A22 22 0 0 1 22 -2 V8" fill="none" stroke="${DEEP}" stroke-width="6"/><rect x="-28" y="0" width="12" height="20" rx="4" fill="${DEEP}"/><rect x="16" y="0" width="12" height="20" rx="4" fill="${DEEP}"/>`,
  };
  return `<g transform="translate(${cx} ${cy})"><circle r="46" fill="url(#cert-yellow)" stroke="${GOLD}" stroke-width="4"/>${g[kind]}</g>`;
}

function calendarIcon(cx: number, cy: number) {
  return `<g transform="translate(${cx} ${cy})"><rect x="-44" y="-38" width="88" height="80" rx="10" fill="none" stroke="${ROYAL}" stroke-width="8"/><path d="M-44 -14 H44" stroke="${ROYAL}" stroke-width="8"/><path d="M-22 -50 V-28 M22 -50 V-28" stroke="${ROYAL}" stroke-width="8" stroke-linecap="round"/><path d="M-22 6 h10 M-4 6 h10 M14 6 h10 M-22 24 h10 M-4 24 h10" stroke="${ROYAL}" stroke-width="9"/></g>`;
}

function bookIcon(cx: number, cy: number) {
  return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${ROYAL}" stroke-width="7" stroke-linejoin="round"><path d="M0 -26 Q-24 -40 -52 -34 V34 Q-24 28 0 40 Q24 28 52 34 V-34 Q24 -40 0 -26 Z"/><path d="M0 -26 V40"/></g>`;
}

function shieldIcon(cx: number, cy: number) {
  return `<g transform="translate(${cx} ${cy})"><path d="M0 -48 L40 -32 V4 Q40 36 0 52 Q-40 36 -40 4 V-32 Z" fill="url(#cert-gold-v)"/><path d="M-18 2 L-4 16 L20 -12" stroke="${DEEP}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

function globeIcon(cx: number, cy: number) {
  return `<g transform="translate(${cx} ${cy})" fill="none" stroke="${WHITE}" stroke-width="5"><circle r="30"/><ellipse rx="13" ry="30"/><path d="M-30 0 H30 M-26 -14 H26 M-26 14 H26"/></g>`;
}

export function renderCertificate(c: CertificateArt, opts: CertificateRenderOptions) {
  const cx = CERT_W / 2;
  let website = "";
  try {
    website = new URL(c.verifyUrl).host;
  } catch {
    website = "";
  }

  // Student name: large faux-italic Poppins Bold. It shrinks to fit the white centre; a name too
  // long for one line even at 60% splits into two balanced lines instead of being squeezed.
  const nameMax = 1640;
  const oneLine = fitSize(c.studentName, 150, 700, nameMax, 0, 0.6);
  const nameLines = oneLine.fit && c.studentName.trim().includes(" ")
    ? wrapToFit(c.studentName, 96, 700, nameMax, 60)
    : { lines: [c.studentName], size: oneLine.size };
  const nameText = (value: string, y: number, size: number, fit: string) =>
    `<g transform="translate(${cx} ${y}) skewX(-9)"><text x="0" y="0" font-family="${FONT}" font-weight="700" font-size="${size.toFixed(1)}" fill="${INK}" text-anchor="middle"${fit}>${esc(value)}</text></g>`;
  const studentName =
    nameLines.lines.length === 1
      ? nameText(c.studentName, 905, oneLine.size, oneLine.fit)
      : nameLines.lines.map((l, i) => nameText(l, 828 + i * (nameLines.size + 4), nameLines.size, fitSize(l, nameLines.size, 700, nameMax).fit)).join("");

  // Course title on the yellow ribbon: one line, or two balanced lines for very long titles.
  const title = wrapToFit(c.courseTitle, 84, 800, 1200, 58);
  const ribbonH = title.lines.length === 1 ? 118 : 178;
  const ribbonTop = 1092;
  const ribbon = `<path d="M${cx - 680} ${ribbonTop} H${cx + 680} L${cx + 640} ${ribbonTop + ribbonH} H${cx - 640} Z" fill="url(#cert-yellow)"/>
    <path d="M${cx - 680} ${ribbonTop} H${cx + 680} L${cx + 676} ${ribbonTop + 12} H${cx - 676} Z" fill="#fff3a6" opacity="0.8"/>`;
  const titleLines = title.lines
    .map((l, i) => text(cx, ribbonTop + (title.lines.length === 1 ? 86 : 74 + i * (title.size + 6)), l, title.size, { weight: 800, fill: INK, maxWidth: 1200 }))
    .join("");
  const shift = ribbonH - 118;

  // Info cards follow the ribbon; the signature block stays put above the footer, and the
  // signature image takes whatever room is left between them.
  const cardY = 1385 + shift;
  const sigLine = 1748;
  const sigTop = Math.max(cardY + 160, 1588);
  const cardTitle = truncateToFit(c.courseTitle, 40, 500, 590);

  const signature = c.signatureHref
    ? `<image href="${esc(c.signatureHref)}" x="${cx - 270}" y="${sigTop}" width="540" height="${sigLine - 8 - sigTop}" preserveAspectRatio="xMidYMax meet"/>`
    : "";
  const signatory = [c.signatoryName, c.signatoryTitle].filter((s) => s.trim()).join(", ");

  const watermark = opts.watermark
    ? `<text x="${cx}" y="${CERT_H / 2 + 120}" font-family="${FONT}" font-weight="800" font-size="320" fill="#dc2626" fill-opacity="0.16" text-anchor="middle" transform="rotate(-18 ${cx} ${CERT_H / 2})">${esc(opts.watermark)}</text>`
    : "";

  const features: [Parameters<typeof featureIcon>[0], string, string][] = [
    ["chart", "Expert", "Guidance"],
    ["play", "Live", "Training"],
    ["certificate", "Certificate", "Provided"],
    ["support", "Lifetime", "Support"],
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CERT_W} ${CERT_H}" width="${CERT_W}" height="${CERT_H}" role="img" aria-label="${esc(`Certificate of completion — ${c.studentName}, ${c.courseTitle}`)}">
  ${DEFS}
  <rect width="${CERT_W}" height="${CERT_H}" fill="url(#cert-blue)"/>

  <!-- white centre -->
  <path d="M600 455 H2400 L2440 495 V1720 Q2440 1830 2330 1850 L1720 1905 H1250 L640 1850 Q530 1830 530 1720 V525 Z" fill="url(#cert-paper)"/>
  <path d="M600 455 H2400 L2440 495" fill="none" stroke="${GOLD}" stroke-width="10"/>

  <!-- gold and blue ribbons -->
  <path d="M0 300 L640 0 H790 L0 420 Z" fill="url(#cert-gold)"/>
  <path d="M0 470 L860 0 H900 L0 500 Z" fill="${YELLOW}" opacity="0.55"/>
  <path d="M2250 470 L2970 270 V350 L2300 520 Z" fill="url(#cert-gold)"/>
  <path d="M0 1556 L905 1806 L940 1925 H0 Z" fill="url(#cert-blue)"/>
  <path d="M0 1500 L905 1750 L905 1810 L0 1560 Z" fill="url(#cert-gold)"/>
  <path d="M2970 1420 L2120 1925 H2200 L2970 1500 Z" fill="url(#cert-gold)"/>
  <path d="M2970 1500 L2200 1925 H2970 Z" fill="url(#cert-blue)"/>

  <!-- header -->
  <g transform="translate(860 232)">
    <circle r="212" fill="url(#cert-gold)"/><circle r="198" fill="${WHITE}"/>
    <image href="${esc(opts.logoHref)}" x="-188" y="-188" width="376" height="376" clip-path="url(#cert-logo-clip)" preserveAspectRatio="xMidYMid slice"/>
  </g>
  ${text(1760, 190, "E-COMMERCE", 176, { weight: 800, fill: WHITE, maxWidth: 1000 })}
  ${text(1760, 316, "TRAINING ACADEMY", 112, { weight: 800, fill: YELLOW, maxWidth: 1000 })}
  ${text(1760, 404, "Learn | Sell | Grow", 64, { weight: 700, fill: WHITE })}
  <g transform="rotate(-10 2580 240)">
    ${text(2500, 150, "Your", 78, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
    ${text(2580, 244, "Growth", 92, { font: SCRIPT_FONT, weight: 500, fill: WHITE })}
    ${text(2575, 338, "Our Mission", 86, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
    <path d="M2430 376 Q2590 362 2740 326" stroke="${WHITE}" stroke-width="6" fill="none" stroke-linecap="round"/>
  </g>

  <!-- "certificate of completion" ribbon -->
  <path d="M${cx - 860} 488 L${cx - 790} 488 L${cx - 790} 640 L${cx - 860} 640 L${cx - 815} 564 Z" fill="#c98f05"/>
  <path d="M${cx + 860} 488 L${cx + 790} 488 L${cx + 790} 640 L${cx + 860} 640 L${cx + 815} 564 Z" fill="#c98f05"/>
  <path d="M${cx - 800} 470 H${cx + 800} V620 H${cx - 800} Z" fill="url(#cert-gold-v)"/>
  <path d="M${cx - 800} 470 H${cx + 800} V482 H${cx - 800} Z" fill="#fff6c4" opacity="0.8"/>
  ${laurel(cx - 735, 545, 56, -1, 6, 17, INK)}${laurel(cx + 735, 545, 56, 1, 6, 17, INK)}
  ${text(cx, 586, "CERTIFICATE OF COMPLETION", 104, { weight: 800, fill: INK, maxWidth: 1180, letterSpacing: 2 })}

  ${text(cx, 728, "THIS CERTIFICATE IS PROUDLY AWARDED TO", 44, { weight: 600, fill: INK, letterSpacing: 14, maxWidth: 1600 })}
  ${studentName}
  <path d="M${cx - 760} 975 H${cx - 60} M${cx + 60} 975 H${cx + 760}" stroke="${GOLD}" stroke-width="5"/>
  <path d="M${cx} 950 L${cx + 26} 975 L${cx} 1000 L${cx - 26} 975 Z" fill="url(#cert-gold)"/>
  <path d="M${cx - 60} 975 Q${cx - 40} 950 ${cx - 26} 975 Q${cx - 40} 1000 ${cx - 60} 975 M${cx + 60} 975 Q${cx + 40} 950 ${cx + 26} 975 Q${cx + 40} 1000 ${cx + 60} 975" fill="none" stroke="${GOLD}" stroke-width="4"/>

  ${text(cx, 1062, "For successfully completing the course", 54, { weight: 500, fill: INK })}
  ${ribbon}${titleLines}

  ${text(cx, 1287 + shift, "We recognize your dedication, hard work and commitment to learning", 40, { weight: 500, fill: INK, maxWidth: 1700 })}
  ${text(cx, 1340 + shift, "e-commerce skills and taking a step towards building a successful online business.", 40, { weight: 500, fill: INK, maxWidth: 1700 })}

  <!-- completion date and course cards -->
  <rect x="745" y="${cardY + 8}" width="610" height="150" rx="22" fill="#d9e1f7"/>
  <rect x="740" y="${cardY}" width="610" height="150" rx="22" fill="${WHITE}" stroke="#dbe3f6" stroke-width="3"/>
  ${calendarIcon(840, cardY + 78)}
  ${text(925, cardY + 64, "Completion Date", 42, { weight: 700, fill: ROYAL, anchor: "start" })}
  ${text(925, cardY + 118, formatCertificateDate(c.completedAt), 42, { weight: 500, fill: INK, anchor: "start", maxWidth: 400 })}
  <path d="M1393 ${cardY + 10} V${cardY + 140}" stroke="#c9d3ee" stroke-width="4"/>
  <rect x="1441" y="${cardY + 8}" width="790" height="150" rx="22" fill="#d9e1f7"/>
  <rect x="1436" y="${cardY}" width="790" height="150" rx="22" fill="${WHITE}" stroke="#dbe3f6" stroke-width="3"/>
  ${bookIcon(1530, cardY + 78)}
  ${text(1610, cardY + 64, "Course Title", 42, { weight: 700, fill: ROYAL, anchor: "start" })}
  ${text(1610, cardY + 118, cardTitle, 40, { weight: 500, fill: INK, anchor: "start", maxWidth: 590 })}

  <!-- signature -->
  ${signature}
  <path d="M${cx - 300} ${sigLine} H${cx + 300}" stroke="${GOLD}" stroke-width="5"/>
  ${text(cx, sigLine + 46, "Authorized Signature", 40, { weight: 700, fill: INK })}
  ${text(cx, sigLine + 90, signatory ? `${signatory} · E-Commerce Training Academy` : "E-Commerce Training Academy", 32, { weight: 600, fill: INK, maxWidth: 1100 })}

  <!-- left panel: medal and features -->
  <rect x="60" y="560" width="450" height="960" rx="34" fill="url(#cert-panel)" stroke="#3b62ef" stroke-width="4"/>
  ${medal(285, 790)}
  ${features
    .map(([kind, a, b], i) => {
      const y = 1172 + i * 106;
      return `${featureIcon(kind, 150, y)}${text(222, y - 6, a, 34, { weight: 600, fill: WHITE, anchor: "start" })}${text(222, y + 34, b, 34, { weight: 600, fill: WHITE, anchor: "start" })}`;
    })
    .join("")}
  <g transform="rotate(-8 330 1790)">
    ${text(270, 1772, "Start Your", 74, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
    ${text(340, 1858, "Online Business", 74, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
    <path d="M130 1900 Q420 1912 720 1862 M680 1846 L722 1861 L690 1892" stroke="${WHITE}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- right panel: QR verification -->
  <rect x="2470" y="590" width="440" height="880" rx="34" fill="url(#cert-panel)" stroke="#3b62ef" stroke-width="4"/>
  <rect x="2510" y="630" width="360" height="470" rx="24" fill="${WHITE}" stroke="url(#cert-gold)" stroke-width="10"/>
  ${qrCode(c.verifyUrl, 2540, 652, 300)}
  <path d="M2515 975 H2865 V1072 Q2865 1095 2842 1095 H2538 Q2515 1095 2515 1072 Z" fill="${DEEP}"/>
  ${text(2690, 1024, "Scan to Verify", 36, { weight: 600, fill: WHITE })}
  ${text(2690, 1070, "This Certificate", 36, { weight: 600, fill: WHITE })}
  ${text(2690, 1178, "CERTIFICATE ID", 38, { weight: 700, fill: WHITE, letterSpacing: 2 })}
  <rect x="2515" y="1206" width="350" height="92" rx="18" fill="${WHITE}"/>
  ${text(2690, 1267, c.certificateNo, 44, { weight: 800, fill: INK, maxWidth: 320 })}
  ${shieldIcon(2560, 1385)}
  ${text(2625, 1358, "This certificate is", 27, { weight: 500, fill: WHITE, anchor: "start" })}
  ${text(2625, 1394, "verifiable online at", 27, { weight: 500, fill: WHITE, anchor: "start" })}
  ${text(2625, 1430, "our official website.", 27, { weight: 500, fill: WHITE, anchor: "start" })}

  <!-- footer -->
  <rect x="0" y="1925" width="${CERT_W}" height="${CERT_H - 1925}" fill="${DEEP}"/>
  <path d="M0 1925 H${CERT_W}" stroke="${GOLD}" stroke-width="8"/>
  ${globeIcon(135, 2012)}
  ${text(190, 2026, website, 40, { weight: 500, fill: WHITE, anchor: "start", maxWidth: 720 })}
  ${text(1590, 2034, "Amazon  |  Flipkart  |  Meesho", 64, { weight: 800, fill: WHITE, letterSpacing: 2, maxWidth: 1000 })}
  <g transform="rotate(-4 2580 2010)">
    ${text(2540, 1992, "Together We Build", 54, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
    ${text(2620, 2052, "Successful Businesses...", 54, { font: SCRIPT_FONT, weight: 500, fill: YELLOW })}
  </g>

  <!-- gold frame -->
  <rect x="14" y="14" width="${CERT_W - 28}" height="${CERT_H - 28}" fill="none" stroke="url(#cert-gold)" stroke-width="28"/>
  <rect x="38" y="38" width="${CERT_W - 76}" height="${CERT_H - 76}" fill="none" stroke="#fde68a" stroke-width="3" opacity="0.7"/>
  ${watermark}
</svg>`;
}

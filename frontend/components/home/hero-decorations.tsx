/**
 * Decorative hero-side artwork. Flat SVG in the brand palette so it ships with no
 * external image assets — swap for real renders by dropping them in /public and
 * replacing the <svg> bodies here.
 */

function CardboardBox({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="3" fill="#d6a56a" />
      <rect x={x} y={y} width={w} height={h * 0.28} rx="3" fill="#e8bf8c" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h * 0.28} stroke="#c08c4f" strokeWidth="1.5" />
    </g>
  );
}

export function HeroArtLeft({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 210" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Laptop */}
      <rect x="120" y="55" width="150" height="95" rx="8" fill="#1e293b" />
      <rect x="128" y="63" width="134" height="79" rx="4" fill="#3b82f6" />
      <rect x="128" y="63" width="134" height="79" rx="4" fill="url(#screenFade)" />
      <rect x="104" y="150" width="182" height="10" rx="5" fill="#334155" />

      {/* Plant */}
      <path d="M44 140c0-18 10-30 10-30s10 12 10 30z" fill="#22c55e" />
      <path d="M36 142c-6-14-2-28-2-28s13 7 16 21z" fill="#16a34a" />
      <path d="M72 142c6-14 2-28 2-28s-13 7-16 21z" fill="#16a34a" />
      <path d="M38 140h34l-5 34a4 4 0 0 1-4 3H47a4 4 0 0 1-4-3z" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />

      {/* Boxes */}
      <CardboardBox x={78} y={120} w={44} h={40} />
      <CardboardBox x={86} y={82} w={34} h={38} />

      <defs>
        <linearGradient id="screenFade" x1="128" y1="63" x2="262" y2="142" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60a5fa" stopOpacity="0.35" />
          <stop offset="1" stopColor="#1d4ed8" stopOpacity="0.55" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function HeroArtRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 210" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Ascending bars */}
      <rect x="18" y="128" width="26" height="42" rx="4" fill="#bfdbfe" />
      <rect x="52" y="108" width="26" height="62" rx="4" fill="#93c5fd" />
      <rect x="86" y="84" width="26" height="86" rx="4" fill="#60a5fa" />
      <rect x="120" y="58" width="26" height="112" rx="4" fill="#3b82f6" />
      <rect x="154" y="34" width="26" height="136" rx="4" fill="#1d4ed8" />

      {/* Growth arrow */}
      <path
        d="M24 112 58 88 92 64 126 40 168 16"
        stroke="#1d4ed8"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M150 14h22v22" stroke="#1d4ed8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Shopping cart */}
      <path
        d="M196 78h12l14 56h52"
        stroke="#1d4ed8"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M214 92h72l-8 32h-56z" fill="#3b82f6" />
      <circle cx="232" cy="150" r="9" fill="#1e293b" />
      <circle cx="268" cy="150" r="9" fill="#1e293b" />

      {/* Boxes in cart */}
      <CardboardBox x={222} y={60} w={30} h={32} />
      <CardboardBox x={254} y={68} w={26} h={24} />
    </svg>
  );
}

export function CurvedArrow({ className = "", flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 90 70"
      className={`${className} ${flip ? "-scale-x-100" : ""}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 6c28 4 48 20 62 50"
        stroke="#1e293b"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M56 50l13 8 3-15" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

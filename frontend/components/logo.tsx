/** Public path of the academy logo (background cut out so it sits cleanly on blue and white). */
export const LOGO_SRC = "/brand/eta-logo.webp";

export function BrandLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static asset; next/image adds nothing here
    <img
      src={LOGO_SRC}
      alt="E-Commerce Training Academy"
      width={512}
      height={512}
      decoding="async"
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

export function LogoMark({
  className = "",
  variant = "dark",
  size = "md",
}: {
  className?: string;
  /** "dark" for use on light backgrounds (default), "white" for blue banners (navbar, footer, sidebar). */
  variant?: "dark" | "white";
  /** "lg" is the larger, responsive lockup used in the main navbar. */
  size?: "md" | "lg";
}) {
  const isWhite = variant === "white";
  const lg = size === "lg";
  return (
    <div className={`flex items-center ${lg ? "gap-2.5 sm:gap-3" : "gap-2.5"} ${className}`}>
      <BrandLogo className={lg ? "h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14" : "h-10 w-10"} />
      <span
        className={`font-display tracking-wide ${
          lg ? "text-[1.15rem] leading-none sm:text-[1.35rem] lg:text-[1.5rem]" : "text-[1.05rem] leading-tight"
        } ${isWhite ? "text-white" : "text-parchment"}`}
      >
        E-Commerce
        <span
          className={`block font-body font-semibold uppercase ${
            lg ? "mt-1 text-[9px] tracking-[0.24em] sm:text-[11px] lg:text-[12.5px] lg:tracking-[0.28em]" : "-mt-1 text-xs tracking-[0.25em]"
          } ${isWhite ? (lg ? "text-white/95" : "text-blue-100") : "text-gold-500"}`}
        >
          Training Academy
        </span>
      </span>
    </div>
  );
}

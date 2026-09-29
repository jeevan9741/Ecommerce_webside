/**
 * Typographic platform wordmarks for the homepage demo cards — brand colours and lettering only,
 * no official logo artwork. Platforms without a style get the academy look.
 */
const STYLES: Record<string, { tile: string; text: string; accent?: string; label?: string }> = {
  meesho: { tile: "bg-[#f43397]", text: "italic lowercase text-white", label: "meesho" },
  flipkart: { tile: "bg-[#2874f0]", text: "italic text-white", accent: "bg-[#ffe11b]", label: "Flipkart" },
  amazon: { tile: "bg-[#131921]", text: "lowercase text-white", accent: "bg-[#ff9900]", label: "amazon" },
  shopify: { tile: "bg-[#f3f8ec]", text: "lowercase text-[#1f3d0c]", accent: "bg-[#95bf47]", label: "shopify" },
};

export function PlatformWordmark({ slug, name, className = "" }: { slug: string; name: string; className?: string }) {
  const style = STYLES[slug] ?? { tile: "bg-gradient-to-br from-[#1424a8] to-[#5b2de6]", text: "text-white" };
  return (
    <span className={`relative flex items-center justify-center overflow-hidden ${style.tile} ${className}`} aria-hidden="true">
      <span className="flex flex-col items-center">
        <span className={`font-sans text-2xl font-extrabold tracking-tight sm:text-[1.7rem] ${style.text}`}>{style.label ?? name}</span>
        {style.accent && <span className={`mt-1 h-1 w-10 rounded-full ${style.accent}`} />}
      </span>
    </span>
  );
}

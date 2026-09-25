import type { NextRequest } from "next/server";
import { api, ApiError, TOKEN_COOKIE } from "@/lib/api";
import { renderCardPdf, renderCardPng } from "@/lib/partner-card/server-render";
import { toCardArt, watermarkFor, type PartnerCard } from "@/lib/partner-card/types";

/**
 * Server-side card exports: /id-cards/{partnerId}/front.png, back.png and card.pdf.
 * The backend decides who may read the card (its owner or an admin); this route only renders.
 * Cards that aren't active still export, but carry a watermark so they can't pass as valid.
 */
const FILES = {
  "front.png": { kind: "png", side: "front" },
  "back.png": { kind: "png", side: "back" },
  "card.pdf": { kind: "pdf" },
} as const;

export async function GET(request: NextRequest, ctx: RouteContext<"/id-cards/[partnerId]/[file]">) {
  const { partnerId, file } = await ctx.params;
  const spec = FILES[file as keyof typeof FILES];
  if (!spec) return Response.json({ error: "Unknown export" }, { status: 404 });

  const token = request.cookies.get(TOKEN_COOKIE)?.value ?? null;
  if (!token) return Response.json({ error: "Sign in required" }, { status: 401 });

  let card: PartnerCard;
  try {
    ({ card } = await api.get<{ card: PartnerCard }>(`/partner-cards/${encodeURIComponent(partnerId)}`, { token }));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Could not load the card" }, { status });
  }

  try {
    const art = toCardArt(card);
    const watermark = watermarkFor(card.status);
    const download = request.nextUrl.searchParams.get("download") !== "0";
    const filename = spec.kind === "pdf" ? `${card.partnerId}-id-card.pdf` : `${card.partnerId}-${spec.side}.png`;
    const body = spec.kind === "pdf" ? await renderCardPdf(art, watermark) : await renderCardPng(art, spec.side, watermark);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": spec.kind === "pdf" ? "application/pdf" : "image/png",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[PARTNER_CARD] Export failed:", err);
    return Response.json({ error: "Could not generate the card. Please try again." }, { status: 500 });
  }
}

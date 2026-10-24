import type { NextRequest } from "next/server";
import { ApiError, TOKEN_COOKIE } from "@/lib/api";
import { certificateVerifyUrl } from "@/lib/certificate/verify";
import { renderCertificatePdf, renderCertificatePng, toDataUrl } from "@/lib/certificate/server-render";
import { certificateService, type CourseCertificate, type Signatory } from "@/services/certificateService";

/**
 * Certificate downloads: /certificates/{certificateNo}/certificate.pdf and certificate.png.
 * The backend decides who may read it (its owner or an admin); this route only renders.
 * Revoked certificates aren't served.
 */
const FILES = { "certificate.pdf": "pdf", "certificate.png": "png" } as const;

export async function GET(request: NextRequest, ctx: RouteContext<"/certificates/[certificateNo]/[file]">) {
  const { certificateNo, file } = await ctx.params;
  const kind = FILES[file as keyof typeof FILES];
  if (!kind) return Response.json({ error: "Unknown file" }, { status: 404 });

  const token = request.cookies.get(TOKEN_COOKIE)?.value ?? null;
  if (!token) return Response.json({ error: "Sign in required" }, { status: 401 });

  let certificate: CourseCertificate;
  let signatory: Signatory;
  try {
    ({ certificate, signatory } = await certificateService.get(certificateNo, token));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Could not load the certificate" }, { status });
  }
  if (certificate.status === "REVOKED") return Response.json({ error: "This certificate has been revoked." }, { status: 410 });

  try {
    const art = {
      certificateNo: certificate.certificateNo,
      studentName: certificate.studentName,
      courseTitle: certificate.courseTitle,
      completedAt: certificate.completedAt,
      signatoryName: signatory.name,
      signatoryTitle: signatory.title,
      signatureHref: await toDataUrl(signatory.signatureUrl),
      verifyUrl: certificateVerifyUrl(certificate.certificateNo),
    };
    const body = kind === "pdf" ? await renderCertificatePdf(art, null) : await renderCertificatePng(art, null);
    const download = request.nextUrl.searchParams.get("download") !== "0";
    const filename = `${certificate.certificateNo}-certificate.${kind}`;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "image/png",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[CERTIFICATE] Render failed:", err);
    return Response.json({ error: "Could not generate the certificate. Please try again." }, { status: 500 });
  }
}

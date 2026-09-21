import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/api";

interface TokenClaims {
  role?: "USER" | "ADMIN";
  exp?: number;
}

/**
 * Reads the JWT's claims WITHOUT verifying the signature. That's deliberate and safe
 * here: the proxy only decides where to redirect, it never serves data. Real
 * authorisation happens on the backend for every API call, and the dashboard/admin
 * layouts re-validate the token with the backend before rendering anything.
 */
function readClaims(token: string | undefined): TokenClaims | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as TokenClaims;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const claims = readClaims(request.cookies.get(TOKEN_COOKIE)?.value);

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!claims || claims.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/courses") || pathname.startsWith("/jobs")) {
    if (!claims) {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
  }

  // The public landing page and About are for signed-out visitors only —
  // send already-authenticated users straight to their dashboard instead.
  if ((pathname === "/" || pathname.startsWith("/about")) && claims) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/about/:path*", "/admin/:path*", "/dashboard/:path*", "/courses/:path*", "/jobs/:path*"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/api";
import { homeFor } from "@/lib/routes";

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

  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/courses") ||
    pathname.startsWith("/jobs") ||
    isPortalAlias(pathname)
  ) {
    if (!claims) {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
  }

  // /my-courses and /portal have no pages of their own. Funnelling them through /dashboard keeps
  // the "has this account bought anything?" decision in one place — the dashboard layout —
  // instead of duplicating it here, where the proxy can only read JWT claims and not purchases.
  if (isPortalAlias(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // The public landing page and About are for signed-out visitors only — send already-authenticated
  // users straight to their home instead (admin panel for admins, portal for everyone else).
  if ((pathname === "/" || pathname.startsWith("/about")) && claims) {
    return NextResponse.redirect(new URL(homeFor(claims.role), request.url));
  }

  return NextResponse.next();
}

/** Alternate names for the customer portal that should behave exactly like /dashboard. */
function isPortalAlias(pathname: string): boolean {
  return ["/my-courses", "/portal"].some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

export const config = {
  matcher: [
    "/",
    "/about/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/courses/:path*",
    "/jobs/:path*",
    "/my-courses/:path*",
    "/portal/:path*",
  ],
};

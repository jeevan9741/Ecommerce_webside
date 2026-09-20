import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await auth();

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!session?.user || session.user.role !== "ADMIN") {
      const url = new URL("/admin/login", request.url);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/courses") || pathname.startsWith("/jobs")) {
    if (!session?.user) {
      const url = new URL("/login", request.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
  }

  // The public landing page and About are for signed-out visitors only —
  // send already-authenticated users straight to their dashboard instead.
  if ((pathname === "/" || pathname.startsWith("/about")) && session?.user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/about/:path*", "/admin/:path*", "/dashboard/:path*", "/courses/:path*", "/jobs/:path*"],
};

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL("/", req.url);
  const res = NextResponse.redirect(url);

  if (/^[A-Z0-9]{4,16}$/i.test(code)) {
    res.cookies.set("eca_ref", code.toUpperCase(), {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  return res;
}

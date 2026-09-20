import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

// Sets a 30-day referral attribution cookie from /r/[code]. Read (never trusted blindly)
// at checkout time, where the referral code is re-validated against real users server-side.
export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({ code: null }));
  if (typeof code !== "string" || !/^[A-Z0-9]{4,16}$/i.test(code)) {
    return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
  }
  const store = await cookies();
  store.set("eca_ref", code.toUpperCase(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return NextResponse.json({ ok: true });
}

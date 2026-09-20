import { NextResponse } from "next/server";
import { getVerifiedEmail } from "@/lib/verified-email-cookie";

export async function GET() {
  const email = await getVerifiedEmail();
  return NextResponse.json({ email });
}

import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "eca_verified_email";
const TTL_MS = 30 * 60 * 1000; // 30 minutes — long enough to finish registration/checkout

function sign(email: string, exp: number): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "dev-secret";
  return crypto.createHmac("sha256", secret).update(`${email.toLowerCase()}:${exp}`).digest("hex");
}

// "|" is not a legal character in an email address, unlike ".", so it safely
// delimits the cookie's fields even though real email domains contain dots.
const FIELD_SEP = "|";

export async function setVerifiedEmailCookie(email: string) {
  const exp = Date.now() + TTL_MS;
  const sig = sign(email, exp);
  const store = await cookies();
  store.set(COOKIE_NAME, [email.toLowerCase(), exp, sig].join(FIELD_SEP), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function getVerifiedEmail(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [email, expStr, sig] = raw.split(FIELD_SEP);
  if (!email || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (Number.isNaN(exp) || Date.now() > exp) return null;
  const expected = sign(email, exp);
  if (expected.length !== sig.length) return null;
  const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  return valid ? email : null;
}

export async function isEmailVerified(email: string): Promise<boolean> {
  const verified = await getVerifiedEmail();
  return !!verified && verified === email.toLowerCase();
}

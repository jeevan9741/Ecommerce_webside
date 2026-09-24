import { redirect } from "next/navigation";

// Old URL — Referral & Earnings now lives at /dashboard/referral.
export default function LegacyReferralsPage() {
  redirect("/dashboard/referral");
}

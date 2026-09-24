import { redirect } from "next/navigation";

// Old URL — the payout request page now lives at /dashboard/referral/withdraw.
export default function LegacyWithdrawPage() {
  redirect("/dashboard/referral/withdraw");
}

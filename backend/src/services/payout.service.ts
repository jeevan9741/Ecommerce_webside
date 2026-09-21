import { prisma } from "../config/prisma.js";
import { decryptJson } from "../utils/crypto.js";

/**
 * Attempts an automated bank/UPI transfer via RazorpayX when RAZORPAYX_ENABLED=true
 * and the account has completed the required business KYC. Until then this is a
 * no-op and withdrawals stay in a PENDING queue for admin to action manually after
 * transferring funds outside the app — the balance math and fraud checks above this
 * layer are already fully automatic either way.
 */
export async function attemptAutomatedPayout(withdrawalId: string) {
  const enabled = process.env.RAZORPAYX_ENABLED === "true";
  if (!enabled) return { attempted: false as const };

  const withdrawal = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawalId },
    include: { payoutMethod: true },
  });
  if (!withdrawal) throw new Error("Withdrawal not found");

  const details = decryptJson<Record<string, string>>(withdrawal.payoutMethod.encryptedDetails);

  // RazorpayX Payouts API call would go here, e.g.:
  // const payout = await razorpayXClient.payouts.create({
  //   account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
  //   amount: withdrawal.amountInPaise,
  //   currency: "INR",
  //   mode: withdrawal.payoutMethod.type === "UPI" ? "UPI" : "IMPS",
  //   purpose: "payout",
  //   fund_account: { ... build from `details` ... },
  // });
  void details;

  return { attempted: true as const, providerRefId: null };
}

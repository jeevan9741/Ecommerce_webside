import { api } from "@/lib/api";

export type PayoutMethodInput =
  | { type: "UPI"; label: string; upiId: string }
  | { type: "BANK"; label: string; accountHolderName: string; accountNumber: string; ifsc: string };

export const referralService = {
  stats: () => api.get<Record<string, unknown>>("/partner/stats"),
  payoutMethods: () => api.get<{ methods: unknown[] }>("/payout-methods"),
  addPayoutMethod: (input: PayoutMethodInput) => api.post<{ method: unknown }>("/payout-methods", input),
  withdrawals: () => api.get<{ withdrawals: unknown[] }>("/withdrawals"),
  requestWithdrawal: (payoutMethodId: string, amountInPaise: number) =>
    api.post<{ withdrawal: unknown }>("/withdrawals", { payoutMethodId, amountInPaise }),
};

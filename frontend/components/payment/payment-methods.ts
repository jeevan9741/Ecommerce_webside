/**
 * Payment methods offered in our own picker, and how each one narrows Razorpay Checkout.
 *
 * Every option below uses only documented Razorpay Checkout configuration:
 * `config.display.blocks` + `sequence` + `preferences.show_default_blocks: false`
 * restricts Checkout to the chosen method, and `prefill.method` pre-selects it.
 *
 * Razorpay limits which UPI apps can be launched directly ("intent") from a mobile
 * browser — on Android mobile web that's Google Pay and PhonePe. So those two get an
 * intent instrument plus a QR / UPI-ID fallback (desktop has no intent at all), and
 * Paytm uses QR / UPI-ID, which works for Paytm users on every device.
 */

export type PaymentMethodId = "upi" | "gpay" | "phonepe" | "paytm" | "credit" | "debit" | "netbanking";

type RazorpayInstrument =
  | { method: "upi"; flows?: ("collect" | "intent" | "qr")[]; apps?: string[] }
  | { method: "card"; types?: ("credit" | "debit")[] }
  | { method: "netbanking" };

export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  hint: string;
  /** Value for Razorpay's `prefill.method`. */
  prefillMethod: "upi" | "card" | "netbanking";
  instruments: RazorpayInstrument[];
}

const UPI_FALLBACK: RazorpayInstrument = { method: "upi", flows: ["qr", "collect"] };

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "upi",
    label: "UPI",
    hint: "Any UPI app or UPI ID",
    prefillMethod: "upi",
    instruments: [{ method: "upi" }],
  },
  {
    id: "gpay",
    label: "Google Pay",
    hint: "Opens the app on mobile",
    prefillMethod: "upi",
    instruments: [{ method: "upi", flows: ["intent"], apps: ["google_pay"] }, UPI_FALLBACK],
  },
  {
    id: "phonepe",
    label: "PhonePe",
    hint: "Opens the app on mobile",
    prefillMethod: "upi",
    instruments: [{ method: "upi", flows: ["intent"], apps: ["phonepe"] }, UPI_FALLBACK],
  },
  {
    id: "paytm",
    label: "Paytm",
    hint: "Scan QR or use your UPI ID",
    prefillMethod: "upi",
    instruments: [UPI_FALLBACK],
  },
  {
    id: "credit",
    label: "Credit Card",
    hint: "Visa, Mastercard, RuPay & more",
    prefillMethod: "card",
    instruments: [{ method: "card", types: ["credit"] }],
  },
  {
    id: "debit",
    label: "Debit Card",
    hint: "All major Indian banks",
    prefillMethod: "card",
    instruments: [{ method: "card", types: ["debit"] }],
  },
  {
    id: "netbanking",
    label: "Net Banking",
    hint: "50+ banks supported",
    prefillMethod: "netbanking",
    instruments: [{ method: "netbanking" }],
  },
];

/** Razorpay Checkout `config` that shows only the chosen method. */
export function buildCheckoutConfig(method: PaymentMethod) {
  return {
    display: {
      blocks: {
        selected: { name: `Pay using ${method.label}`, instruments: method.instruments },
      },
      sequence: ["block.selected"],
      preferences: { show_default_blocks: false },
    },
  };
}

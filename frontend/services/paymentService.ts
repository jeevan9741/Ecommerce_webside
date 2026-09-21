import { api } from "@/lib/api";

export interface CreateOrderInput {
  courseId: string;
  selectedLanguage?: string | null;
  referralCode?: string | null;
}

export interface CreatedOrder {
  orderId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  currency: "INR";
  keyId: string;
  courseName: string;
}

export const paymentService = {
  createOrder: (input: CreateOrderInput) => api.post<CreatedOrder>("/checkout/create-order", input),
  orderStatus: (orderId: string) => api.get<{ status: string }>(`/orders/${orderId}/status`),
  /** Self-heal: asks the backend to reconcile directly with Razorpay if the webhook was missed. */
  syncOrder: (orderId: string) => api.post<Record<string, unknown>>(`/orders/${orderId}/sync`),
};

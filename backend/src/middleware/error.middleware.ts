import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http.js";
import { RazorpayConfigError } from "../services/razorpay.service.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err instanceof RazorpayConfigError) {
    console.error("[PAYMENT] Razorpay configuration error:", err.message);
    return res.status(500).json({ error: "Payment gateway is not configured correctly. Please contact support." });
  }
  // Prisma "record not found" on update/delete.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
    return res.status(404).json({ error: "Not found" });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}

/**
 * Public URLs with production-safe fallbacks. NEXT_PUBLIC_* values are baked in at build time, so
 * a production build without them must still point at the live services — never at localhost.
 */
const isProduction = process.env.NODE_ENV === "production";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (isProduction ? "https://ecommerce-training-academy-jeevan-f45f.vercel.app" : "http://localhost:3000")
).replace(/\/$/, "");

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  (isProduction ? "https://ecommerce-training-academy-backend.onrender.com" : "http://localhost:5000")
).replace(/\/$/, "");

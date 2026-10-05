/**
 * Public URLs. NEXT_PUBLIC_* values are baked in at build time — redeploy after changing them.
 */
const isProduction = process.env.NODE_ENV === "production";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (isProduction ? "https://www.ecommercetrainingacademyeta.com" : "http://localhost:3000")
).replace(/\/$/, "");

/**
 * The backend comes only from NEXT_PUBLIC_API_URL. There is deliberately no production fallback:
 * a hardcoded one silently sent the live site to a different Render service (with different CORS
 * settings) when the variable was missing from a build. Failing the build is the safer outcome.
 */
function apiUrl() {
  const value = process.env.NEXT_PUBLIC_API_URL;
  if (value) return value.replace(/\/$/, "");
  if (isProduction) {
    throw new Error("NEXT_PUBLIC_API_URL is not set — add it in Vercel → Settings → Environment Variables (Production) and redeploy.");
  }
  return "http://localhost:5000";
}

export const API_URL = apiUrl();

import type { MetadataRoute } from "next";

// Served as a route handler rather than the app/manifest.ts file convention: that convention
// injects its own <link rel="manifest"> without credentials on production builds, so on a
// Vercel-protected deployment the request is bounced to vercel.com/sso-api and fails CORS.
// The layout renders the link itself with crossOrigin="use-credentials" instead.
export const dynamic = "force-static";

const manifest: MetadataRoute.Manifest = {
  name: "E-Commerce Training Academy",
  short_name: "ECA",
  description:
    "Learn to build and scale a profitable e-commerce business — e-books, recorded courses, live Zoom classes, and in-person academy training.",
  start_url: "/",
  display: "standalone",
  background_color: "#F8FAFC",
  theme_color: "#2563EB",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  return Response.json(manifest, { headers: { "Content-Type": "application/manifest+json" } });
}

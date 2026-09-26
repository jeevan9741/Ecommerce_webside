import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // resvg ships a native binary per platform; keep it out of the bundle and load it from node_modules.
  serverExternalPackages: ["@resvg/resvg-js"],
  // The card export route reads its fonts and logo from disk at runtime.
  outputFileTracingIncludes: {
    "/id-cards/**": ["./public/fonts/card/*.ttf", "./public/brand/card-logo.jpg"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Partner Dashboard became the "Referral & Earnings" page.
      { source: "/dashboard/partner", destination: "/dashboard/referral", permanent: true },
      { source: "/dashboard/partner/:path*", destination: "/dashboard/referral", permanent: true },
      // Orders/Purchases was renamed to "Activity". (/dashboard/profile is a real page again.)
      { source: "/dashboard/orders", destination: "/dashboard/activity", permanent: true },
      // The student "My ID Card" page was removed; old bookmarks land on the portal overview.
      { source: "/dashboard/id-card", destination: "/dashboard", permanent: true },
    ];
  },
};

export default nextConfig;

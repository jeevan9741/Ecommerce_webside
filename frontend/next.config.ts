import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;

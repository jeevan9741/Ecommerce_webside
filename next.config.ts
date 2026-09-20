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
      // Partner Dashboard was merged into the main Dashboard's "Referral & Earnings" section.
      { source: "/dashboard/partner", destination: "/dashboard", permanent: true },
      { source: "/dashboard/partner/:path*", destination: "/dashboard", permanent: true },
      // Orders/Purchases was renamed to "Activity"; Profile Settings was folded into Overview.
      { source: "/dashboard/orders", destination: "/dashboard/activity", permanent: true },
      { source: "/dashboard/profile", destination: "/dashboard", permanent: true },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  distDir: process.env.CLUTCH_BROWSER_TEST === "1" ? ".next-clutch-test" : ".next",
  devIndicators: process.env.CLUTCH_BROWSER_TEST === "1" ? false : undefined,
};

export default nextConfig;

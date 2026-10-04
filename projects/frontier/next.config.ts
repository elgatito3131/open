import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://127.0.0.1:4203/api/:path*" }];
  },
};

export default config;

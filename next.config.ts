import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be reached from the LAN IP (dev-only; affects
  // dev-server assets/HMR, not production).
  allowedDevOrigins: ["192.168.4.112"],
};

export default nextConfig;

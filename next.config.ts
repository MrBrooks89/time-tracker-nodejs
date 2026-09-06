import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to be reached from any LAN IP (dev-only; affects
  // dev-server assets/HMR, not production). Wildcard per dot-segment, so any
  // 192.168.x.y address works without hardcoding the machine's current IP.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Allow both localhost and 127.0.0.1 in dev (HMR / client runtime)
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;

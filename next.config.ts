import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Le webhook Dahua est exclu du middleware d'auth
};

export default nextConfig;

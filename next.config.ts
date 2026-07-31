import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // L'auth est vérifiée par route (layout du dashboard + `auth()` dans les
  // routes API). Le webhook Dahua est volontairement public : il s'authentifie
  // par son token d'URL.
};

export default nextConfig;

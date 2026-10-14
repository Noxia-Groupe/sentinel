import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pas de bannière `X-Powered-By` : inutile de publier le framework.
  poweredByHeader: false,
  // L'optimiseur d'images (`/_next/image`) n'est pas utilisé — la seule image
  // servie est une capture en data-URL, déjà `unoptimized`. Le désactiver
  // retire une surface exposée sans authentification.
  images: { unoptimized: true },
  // L'auth est vérifiée par route (layout du dashboard + `auth()` dans les
  // routes API). Le webhook Dahua est volontairement public : il s'authentifie
  // par son token d'URL, avec limitation de débit (src/lib/rate-limit.ts).
};

export default nextConfig;

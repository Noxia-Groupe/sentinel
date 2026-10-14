import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Politique de sécurité du contenu. Next.js injecte des scripts en ligne pour
 * l'hydratation, d'où `'unsafe-inline'` sur les scripts (sans nonce) ; le
 * reste est fermé : aucun script, style, image ou connexion vers un domaine
 * tiers, aucun cadre parent. Les images `data:` sont les captures et l'avatar
 * Microsoft (converti en base64 à la connexion) ; `blob:` sert au direct.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Pas de bannière `X-Powered-By` : inutile de publier le framework.
  poweredByHeader: false,
  // L'optimiseur d'images (`/_next/image`) n'est pas utilisé — la seule image
  // servie est une capture en data-URL, déjà `unoptimized`. Le désactiver
  // retire une surface exposée sans authentification.
  images: { unoptimized: true },
  // En-têtes de sécurité posés par l'application elle-même : ils ne dépendent
  // pas de la configuration du reverse proxy.
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // L'auth est vérifiée par route (layout du dashboard + gardes dans les
  // routes API), avec un refus par défaut dans src/proxy.ts. Le webhook Dahua
  // est volontairement public : il s'authentifie par son token d'URL, avec
  // limitation de débit (src/lib/rate-limit.ts).
};

export default nextConfig;

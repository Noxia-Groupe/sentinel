import { NextResponse, type NextRequest } from "next/server";

/**
 * Refus par défaut : toute route hors de la liste publique exige au moins un
 * cookie de session. Contrôle « optimiste » et bon marché — la validation
 * réelle de la session et du rôle reste dans chaque route (src/lib/session.ts)
 * et dans les layouts ; ce filtre ferme la porte à une route qui aurait oublié
 * son garde, sans toucher à la base à chaque requête.
 *
 * Routes publiques par conception :
 * - /api/auth/*          — Auth.js (connexion, rappel OAuth, session) ;
 * - /api/webhooks/dahua/* — réception des alarmes (jeton d'URL + limitation) ;
 * - /api/v1/*, /api/mcp   — API des agents (clé d'API) ;
 * - /auth/*               — pages de connexion, refus et erreur.
 */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/webhooks/dahua/", "/api/v1", "/api/mcp", "/auth/"];

/** Noms du cookie de session Auth.js, avec et sans préfixe `__Secure-` (HTTPS). */
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, ""),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const signin = request.nextUrl.clone();
  signin.pathname = "/auth/signin";
  signin.search = "";
  signin.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signin);
}

export const config = {
  // Tout sauf les ressources internes de Next.js (statiques, HMR) et les icônes.
  matcher: ["/((?!_next/|icon\\.svg|favicon\\.ico).*)"],
};

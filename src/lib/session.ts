import { NextResponse } from "next/server";
import { auth } from "./auth";
import { requestIp, type Actor } from "./actor";
import { ROLE_LABELS, normalizeRole, roleAtLeast, type AccessRole } from "./access";

/**
 * Gardes d'authentification des routes de l'interface : renvoient l'acteur
 * correspondant à la session SSO, ou la réponse d'erreur à retourner tel quel.
 *
 * `requireUser` accepte tout rôle ; `requireRole` exige un rôle minimal
 * (voir src/lib/access.ts pour l'échelle). Une route choisit le garde le plus
 * strict qui convient à ce qu'elle fait.
 */
export type SessionGuard =
  | { ok: true; actor: Actor; role: AccessRole; email: string }
  | { ok: false; response: NextResponse };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origines depuis lesquelles l'interface est servie (NEXTAUTH_URL, AUTH_URL). */
function allowedOrigins(): string[] {
  return [process.env.NEXTAUTH_URL, process.env.AUTH_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => value !== null);
}

/**
 * Anti-CSRF des routes à session. Le cookie `SameSite=Lax` arrête un site
 * tiers, mais pas un autre sous-domaine du même site : on exige donc, pour
 * toute requête qui modifie quelque chose, que le navigateur la déclare
 * `same-origin` (`Sec-Fetch-Site`) ou que son `Origin` soit celui de la
 * plateforme. Les clients sans ces en-têtes (outils en ligne de commande avec
 * un cookie copié) restent acceptés : ils ne sont pas des navigateurs.
 */
export function crossSiteRequest(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;

  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = allowedOrigins();
  return allowed.length > 0 && !allowed.includes(origin);
}

export function roleForbidden(minimum: AccessRole): NextResponse {
  return NextResponse.json(
    { error: `Action réservée au rôle « ${ROLE_LABELS[minimum]} » ou supérieur` },
    { status: 403 },
  );
}

export async function requireUser(req: Request): Promise<SessionGuard> {
  if (crossSiteRequest(req)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Requête refusée : origine non autorisée" }, { status: 403 }),
    };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
    };
  }

  // Session encore ouverte mais accès retiré (banni, retiré de la liste).
  if (session.user.denied) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Accès à la plateforme non autorisé pour ce compte" },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    role: normalizeRole(session.user.role),
    email: session.user.email ?? "",
    actor: {
      type: "user",
      id: session.user.id,
      label: session.user.email ?? session.user.name ?? session.user.id,
      ip: requestIp(req),
    },
  };
}

/** Exige un rôle minimal (voir l'échelle dans src/lib/access.ts). */
export async function requireRole(req: Request, minimum: AccessRole): Promise<SessionGuard> {
  const guard = await requireUser(req);
  if (!guard.ok) return guard;
  if (!roleAtLeast(guard.role, minimum)) return { ok: false, response: roleForbidden(minimum) };
  return guard;
}

/** Déclaration, modification, tests, interventions de lecture, direct vidéo. */
export function requireOperator(req: Request): Promise<SessionGuard> {
  return requireRole(req, "operator");
}

/** Mots de passe en clair, suppressions, actions qui modifient l'équipement. */
export function requireAdmin(req: Request): Promise<SessionGuard> {
  return requireRole(req, "admin");
}

/** Réservé aux superadmins : paramètres, liste d'accès, clés d'API, journal d'audit. */
export function requireSuperadmin(req: Request): Promise<SessionGuard> {
  return requireRole(req, "superadmin");
}

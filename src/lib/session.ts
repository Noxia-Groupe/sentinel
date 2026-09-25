import { NextResponse } from "next/server";
import { auth } from "./auth";
import { requestIp, type Actor } from "./actor";

/**
 * Garde d'authentification des routes de l'interface : renvoie l'acteur
 * correspondant à la session SSO, ou la réponse d'erreur à retourner tel quel.
 */
export type SessionGuard =
  | { ok: true; actor: Actor; role: string; email: string }
  | { ok: false; response: NextResponse };

export async function requireUser(req: Request): Promise<SessionGuard> {
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
    role: session.user.role ?? "user",
    email: session.user.email ?? "",
    actor: {
      type: "user",
      id: session.user.id,
      label: session.user.email ?? session.user.name ?? session.user.id,
      ip: requestIp(req),
    },
  };
}

/** Réservé aux superadmins : paramètres, liste d'accès, clés d'API, journal d'audit. */
export async function requireSuperadmin(req: Request): Promise<SessionGuard> {
  const guard = await requireUser(req);
  if (!guard.ok) return guard;
  if (guard.role !== "superadmin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Action réservée au superadmin" },
        { status: 403 },
      ),
    };
  }
  return guard;
}

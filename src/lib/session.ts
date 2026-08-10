import { NextResponse } from "next/server";
import { auth } from "./auth";
import { requestIp, type Actor } from "./actor";

/**
 * Garde d'authentification des routes de l'interface : renvoie l'acteur
 * correspondant à la session SSO, ou la réponse d'erreur à retourner tel quel.
 */
export type SessionGuard =
  | { ok: true; actor: Actor; role: string }
  | { ok: false; response: NextResponse };

export async function requireUser(req: Request): Promise<SessionGuard> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Non autorisé" }, { status: 401 }),
    };
  }

  return {
    ok: true,
    role: session.user.role ?? "user",
    actor: {
      type: "user",
      id: session.user.id,
      label: session.user.email ?? session.user.name ?? session.user.id,
      ip: requestIp(req),
    },
  };
}

/** Réservé aux superadmins (gestion des clés d'API, du journal d'audit…). */
export async function requireAdmin(req: Request): Promise<SessionGuard> {
  const guard = await requireUser(req);
  if (!guard.ok) return guard;
  if (guard.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Action réservée aux administrateurs" },
        { status: 403 },
      ),
    };
  }
  return guard;
}

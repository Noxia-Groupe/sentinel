import { prisma } from "./prisma";

/**
 * Contrôle d'accès à la plateforme.
 *
 * Une connexion Microsoft valide ne suffit pas : l'adresse doit figurer dans la
 * liste d'accès avec le statut « autorisé », et ne pas être bannie. Les
 * adresses de `ADMIN_EMAILS` sont superadmins d'office — c'est l'amorçage qui
 * évite de s'enfermer dehors, elles ne sont pas modifiables depuis l'interface.
 *
 * Rôles :
 * - `superadmin` : tout, y compris les paramètres (accès, clés d'API, audit) ;
 * - `user` : tout voir et tout faire, sauf les paramètres.
 * (Un rôle intermédiaire `admin` pourra s'intercaler plus tard.)
 */

export const ACCESS_ROLES = ["user", "superadmin"] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

export const ACCESS_STATUSES = ["authorized", "banned", "pending"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export type AccessDecision =
  | { allowed: true; role: AccessRole }
  | { allowed: false; reason: "unknown" | "pending" | "banned" | "no-email" };

export function isAccessRole(value: unknown): value is AccessRole {
  return typeof value === "string" && (ACCESS_ROLES as readonly string[]).includes(value);
}

export function isAccessStatus(value: unknown): value is AccessStatus {
  return typeof value === "string" && (ACCESS_STATUSES as readonly string[]).includes(value);
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Superadmins déclarés par la configuration serveur (`ADMIN_EMAILS`). */
export function bootstrapSuperadmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

export function isBootstrapSuperadmin(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && bootstrapSuperadmins().includes(normalized);
}

/** Décide si une adresse peut accéder à la plateforme, et avec quel rôle. */
export async function resolveAccess(email: string | null | undefined): Promise<AccessDecision> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { allowed: false, reason: "no-email" };
  if (isBootstrapSuperadmin(normalized)) return { allowed: true, role: "superadmin" };

  const entry = await prisma.accessEntry.findUnique({
    where: { email: normalized },
    select: { status: true, role: true },
  });
  if (!entry) return { allowed: false, reason: "unknown" };
  if (entry.status === "banned") return { allowed: false, reason: "banned" };
  if (entry.status !== "authorized") return { allowed: false, reason: "pending" };
  return { allowed: true, role: isAccessRole(entry.role) ? entry.role : "user" };
}

/**
 * Trace une tentative de connexion.
 *
 * - accès accordé : horodate la dernière connexion ;
 * - adresse inconnue : crée une entrée « en attente », que le superadmin
 *   retrouve dans ses paramètres pour l'autoriser (ou la bannir) en un clic ;
 * - adresse connue mais refusée : horodate la tentative, sans rien changer.
 *
 * Ne lève jamais : un incident d'écriture ne doit ni ouvrir ni bloquer l'accès,
 * la décision ayant déjà été prise par `resolveAccess`.
 */
export async function recordLoginAttempt(
  email: string | null | undefined,
  name: string | null | undefined,
  decision: AccessDecision,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const now = new Date();
  const displayName = name?.trim() || undefined;
  try {
    if (decision.allowed) {
      await prisma.accessEntry.updateMany({
        where: { email: normalized },
        data: { lastLoginAt: now, ...(displayName ? { name: displayName } : {}) },
      });
      return;
    }
    await prisma.accessEntry.upsert({
      where: { email: normalized },
      create: { email: normalized, name: displayName, status: "pending", lastAttemptAt: now },
      update: { lastAttemptAt: now, ...(displayName ? { name: displayName } : {}) },
    });
  } catch (error) {
    console.error("[access] Échec de la trace de connexion", error);
  }
}

/**
 * Coupe immédiatement les sessions ouvertes d'une adresse (bannissement,
 * retrait de la liste) : sans cela, un navigateur déjà connecté garderait sa
 * session jusqu'à expiration.
 */
export async function revokeSessions(email: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { user: { email: { equals: normalizeEmail(email), mode: "insensitive" } } },
  });
  return count;
}

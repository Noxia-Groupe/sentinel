import { prisma } from "./prisma";
import { envInt } from "./rate-limit";

/**
 * Contrôle d'accès à la plateforme.
 *
 * Une connexion Microsoft valide ne suffit pas : l'adresse doit figurer dans la
 * liste d'accès avec le statut « autorisé », et ne pas être bannie. Les
 * adresses de `ADMIN_EMAILS` sont superadmins d'office — c'est l'amorçage qui
 * évite de s'enfermer dehors, elles ne sont pas modifiables depuis l'interface.
 *
 * Rôles, du moins au plus puissant (chacun inclut les précédents) :
 * - `viewer`     : consulte le parc et traite les alarmes (main courante) ;
 * - `operator`   : déclare et modifie les enregistreurs et les comptes, teste
 *                  les accès, interventions de lecture et mise à l'heure,
 *                  direct vidéo ;
 * - `admin`      : mots de passe en clair, suppressions, redémarrage, PoE,
 *                  relais, centre d'alarme et jeton de webhook ;
 * - `superadmin` : paramètres (accès, clés d'API, webhooks, supervision, audit).
 *
 * L'ancien rôle `user` (tout sauf les paramètres) vaut `admin` : la migration
 * `20261014150000_access_roles` le renomme, et `normalizeRole` couvre une base
 * non migrée. Les nouvelles autorisations sont `operator` par défaut.
 */

export const ACCESS_ROLES = ["viewer", "operator", "admin", "superadmin"] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

export const DEFAULT_ROLE: AccessRole = "operator";

export const ROLE_LABELS: Record<AccessRole, string> = {
  viewer: "Lecture",
  operator: "Opérateur",
  admin: "Administrateur",
  superadmin: "Superadmin",
};

export const ROLE_DESCRIPTIONS: Record<AccessRole, string> = {
  viewer: "Consulte le parc et traite les alarmes",
  operator: "Déclare et teste les enregistreurs, interventions non destructives, direct vidéo",
  admin: "Mots de passe en clair, suppressions, redémarrages, relais, centre d'alarme",
  superadmin: "Paramètres : accès, clés d'API, webhooks, supervision, audit",
};

const ROLE_RANK: Record<AccessRole, number> = { viewer: 0, operator: 1, admin: 2, superadmin: 3 };

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

/** Rôle effectif d'une valeur stockée : `user` (historique) vaut `admin`, l'inconnu vaut `viewer`. */
export function normalizeRole(value: unknown): AccessRole {
  if (value === "user") return "admin";
  return isAccessRole(value) ? value : "viewer";
}

/** Vrai si `role` accorde au moins les droits de `minimum`. */
export function roleAtLeast(role: unknown, minimum: AccessRole): boolean {
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[minimum];
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
  return { allowed: true, role: normalizeRole(entry.role) };
}

/** Nombre maximal de demandes « en attente » conservées (anti-pollution). */
const PENDING_MAX = envInt("ACCESS_PENDING_MAX", 50);
/** Une demande sans suite est oubliée au bout de 30 jours. */
const PENDING_TTL_MS = 30 * 24 * 3600_000;
/** Le nom affiché vient du compte Microsoft : on le borne. */
const NAME_MAX = 120;

/**
 * Trace une tentative de connexion.
 *
 * - accès accordé : horodate la dernière connexion ;
 * - adresse inconnue : crée une entrée « en attente », que le superadmin
 *   retrouve dans ses paramètres pour l'autoriser (ou la bannir) en un clic —
 *   dans la limite de `ACCESS_PENDING_MAX` entrées, les demandes de plus de
 *   30 jours étant purgées au passage ;
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
  const displayName = name?.trim().slice(0, NAME_MAX) || undefined;
  try {
    if (decision.allowed) {
      await prisma.accessEntry.updateMany({
        where: { email: normalized },
        data: { lastLoginAt: now, ...(displayName ? { name: displayName } : {}) },
      });
      return;
    }

    const existing = await prisma.accessEntry.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) {
      await prisma.accessEntry.update({
        where: { id: existing.id },
        data: { lastAttemptAt: now, ...(displayName ? { name: displayName } : {}) },
      });
      return;
    }

    await prisma.accessEntry.deleteMany({
      where: { status: "pending", lastAttemptAt: { lt: new Date(now.getTime() - PENDING_TTL_MS) } },
    });
    const pending = await prisma.accessEntry.count({ where: { status: "pending" } });
    if (pending >= PENDING_MAX) {
      console.warn(`[access] Demande ignorée (${PENDING_MAX} déjà en attente) : ${normalized}`);
      return;
    }
    await prisma.accessEntry.create({
      data: { email: normalized, name: displayName, status: "pending", lastAttemptAt: now },
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

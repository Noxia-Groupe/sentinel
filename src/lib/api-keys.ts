import crypto from "node:crypto";
import { prisma } from "./prisma";
import type { Actor } from "./actor";

/**
 * Clés d'API : elles ouvrent l'accès à `/api/v1`, destiné aux intégrations et
 * aux agents IA. Le secret n'est affiché qu'à la création ; seul son SHA-256
 * est conservé.
 */

export const SCOPES = {
  "alarms:read": "Consulter les alarmes et leur main courante",
  "alarms:write": "Traiter les alarmes (prise en compte, clôture, commentaires)",
  "nvr:read": "Consulter les clients et l'inventaire des enregistreurs",
  "nvr:test": "Tester les connexions et vérifier les droits des comptes",
  "nvr:control": "Agir à distance (redémarrage, mise à l'heure, relais, capture)",
  "credentials:read": "Lire les mots de passe enregistrés en clair",
  "audit:read": "Consulter le journal d'audit",
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** Jeu de scopes conseillé pour un agent d'exploitation (lecture + triage). */
export const DEFAULT_SCOPES: Scope[] = ["alarms:read", "alarms:write", "nvr:read", "nvr:test"];

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (ALL_SCOPES as string[]).includes(value);
}

const KEY_PREFIX = "sntl";

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export type GeneratedKey = { secret: string; prefix: string; hash: string };

/**
 * Génère un secret de la forme `sntl_<8 hex>_<48 hex>`.
 * Le segment médian sert de préfixe public : il identifie la clé dans
 * l'interface et permet de la retrouver en base sans déchiffrer quoi que ce soit.
 */
export function generateApiKey(): GeneratedKey {
  const publicPart = crypto.randomBytes(4).toString("hex");
  const secretPart = crypto.randomBytes(24).toString("hex");
  const secret = `${KEY_PREFIX}_${publicPart}_${secretPart}`;
  return {
    secret,
    prefix: `${KEY_PREFIX}_${publicPart}`,
    hash: hashSecret(secret),
  };
}

export type ApiKeyAuthFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
};

export type ApiKeyAuthSuccess = {
  ok: true;
  actor: Actor;
  keyId: string;
  scopes: string[];
};

/** Extrait le secret d'un en-tête `Authorization: Bearer …` ou `X-Api-Key`. */
export function extractSecret(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  return req.headers.get("x-api-key")?.trim() || undefined;
}

// Mise à jour de `lastUsedAt` au plus une fois par minute et par clé : une
// écriture par appel d'API n'apporte rien et alourdit la base.
const lastUsedWrites = new Map<string, number>();
const LAST_USED_THROTTLE_MS = 60_000;

export async function authenticateApiKey(req: Request): Promise<ApiKeyAuthSuccess | ApiKeyAuthFailure> {
  const secret = extractSecret(req);
  if (!secret) {
    return {
      ok: false,
      status: 401,
      error: "Clé d'API manquante — utiliser l'en-tête `Authorization: Bearer <clé>`.",
    };
  }

  const parts = secret.split("_");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { ok: false, status: 401, error: "Format de clé d'API invalide" };
  }

  const key = await prisma.apiKey.findUnique({ where: { prefix: `${parts[0]}_${parts[1]}` } });
  if (!key) {
    return { ok: false, status: 401, error: "Clé d'API inconnue" };
  }

  const expected = Buffer.from(key.hash, "utf8");
  const provided = Buffer.from(hashSecret(secret), "utf8");
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, status: 401, error: "Clé d'API invalide" };
  }

  if (key.revokedAt) {
    return { ok: false, status: 403, error: "Clé d'API révoquée" };
  }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 403, error: "Clé d'API expirée" };
  }

  const now = Date.now();
  const previous = lastUsedWrites.get(key.id) ?? 0;
  if (now - previous > LAST_USED_THROTTLE_MS) {
    lastUsedWrites.set(key.id, now);
    prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch((error) => console.error("[api-keys] lastUsedAt", error));
  }

  return {
    ok: true,
    keyId: key.id,
    scopes: key.scopes,
    actor: {
      type: "apikey",
      id: key.id,
      label: key.name,
      scopes: key.scopes,
    },
  };
}

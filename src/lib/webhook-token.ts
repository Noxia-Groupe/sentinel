import crypto from "node:crypto";

/**
 * Jeton d'URL du webhook Dahua : l'unique secret qui authentifie un
 * enregistreur auprès de `/api/webhooks/dahua/[token]`.
 *
 * 192 bits d'aléa cryptographique encodés en base64url (32 caractères, aucun
 * caractère à échapper dans une URL, longueur proche de l'ancien format pour
 * les champs de configuration des enregistreurs). Les jetons historiques
 * étaient des `cuid()` — horodatage, compteur et empreinte prévisibles pour
 * ~41 bits d'aléa : ils sont signalés comme faibles et à régénérer depuis la
 * fiche de l'enregistreur.
 */

const TOKEN_BYTES = 24;

/** Forme acceptée par la route de réception : base64url ou cuid historique. */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

/** cuid v1 (Prisma `@default(cuid())`) : `c` suivi de 24 caractères [a-z0-9]. */
const LEGACY_TOKEN_RE = /^c[a-z0-9]{24}$/;

export function generateWebhookToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Filtre amont, avant toute requête en base. */
export function isWellFormedWebhookToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** Vrai pour un jeton de l'ancienne génération, à régénérer. */
export function isLegacyWebhookToken(value: string): boolean {
  return LEGACY_TOKEN_RE.test(value);
}

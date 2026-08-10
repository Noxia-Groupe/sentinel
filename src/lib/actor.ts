/**
 * Un « acteur » est l'auteur d'une action : un utilisateur connecté par SSO,
 * une clé d'API (intégration ou agent IA), ou la plateforme elle-même.
 *
 * Toutes les opérations sensibles reçoivent un acteur, ce qui permet de tracer
 * indifféremment une action humaine et une action automatisée.
 */
export type ActorType = "user" | "apikey" | "system";

export type Actor = {
  type: ActorType;
  /** Identifiant utilisateur ou identifiant de clé d'API. */
  id?: string;
  /** Libellé affiché dans les journaux (e-mail, nom de la clé). */
  label: string;
  /** Scopes accordés — uniquement renseigné pour les clés d'API. */
  scopes?: string[];
  ip?: string;
};

export const SYSTEM_ACTOR: Actor = { type: "system", label: "SENTINEL" };

/** Adresse d'origine de la requête, derrière le reverse proxy. */
export function requestIp(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? undefined;
}

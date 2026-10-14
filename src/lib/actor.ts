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

/**
 * Adresse d'origine de la requête, derrière le reverse proxy.
 *
 * `X-Real-IP` est posé par Nginx Proxy Manager à partir de l'adresse de la
 * connexion : le client ne peut pas le forger. `X-Forwarded-For` est au
 * contraire *complété* par le proxy : la première valeur est celle que le
 * client a pu envoyer lui-même, seule la dernière est digne de confiance.
 * Cette adresse alimente le journal d'audit et la limitation de débit par IP.
 */
export function requestIp(req: Request): string | undefined {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return undefined;
}

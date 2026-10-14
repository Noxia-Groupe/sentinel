/**
 * Bornes des champs texte reçus par les routes. Les chaînes libres sont
 * tronquées à leur maximum (rien ne justifie un nom de 10 000 caractères) ;
 * les valeurs qui ne supportent pas la troncature (mot de passe) sont
 * refusées au-delà de la limite.
 */
export const LIMITS = {
  name: 120,
  label: 120,
  username: 128,
  password: 256,
  code: 64,
  email: 254,
  phone: 40,
  address: 500,
  notes: 4000,
  reason: 500,
  comment: 4000,
  host: 253,
  serial: 64,
  model: 120,
  location: 255,
  type: 32,
} as const;

/** Chaîne nettoyée et bornée ; `null` si absente, vide ou d'un autre type. */
export function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Comme `clip`, mais renvoie `""` plutôt que `null` (champs obligatoires). */
export function clipRequired(value: unknown, max: number): string {
  return clip(value, max) ?? "";
}

/** Types de comptes connus sur un enregistreur. */
export const CREDENTIAL_TYPES = ["admin", "telesurveilleur", "installateur", "client", "technicien"] as const;

export function isCredentialType(value: unknown): value is (typeof CREDENTIAL_TYPES)[number] {
  return typeof value === "string" && (CREDENTIAL_TYPES as readonly string[]).includes(value);
}

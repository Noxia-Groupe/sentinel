import crypto from "crypto";

/**
 * Chiffrement des secrets en base (mots de passe d'enregistreurs, secrets de
 * webhooks) : AES-256-GCM.
 *
 * Format produit : `k<id>:<iv>:<authTag>:<données>` (hexadécimal), où `<id>`
 * identifie la clé utilisée (8 premiers hexas du SHA-256 de la clé). L'ancien
 * format `<iv>:<authTag>:<données>` reste lu.
 *
 * Rotation : renseigner la nouvelle clé dans `ENCRYPTION_KEY` et l'ancienne
 * dans `ENCRYPTION_KEY_PREVIOUS`, puis redémarrer — les chiffrés existants
 * sont relus avec l'ancienne clé et réécrits avec la nouvelle au démarrage
 * (src/lib/encryption-rotation.ts). `ENCRYPTION_KEY_PREVIOUS` peut ensuite
 * être retirée.
 */

const ALGORITHM = "aes-256-gcm";
/** 96 bits : taille d'IV recommandée pour GCM (NIST SP 800-38D). */
const IV_LENGTH = 12;

type Key = { id: string; key: Buffer };
type KeyRing = { current: Key; previous: Key | null };

function decodeKey(raw: string, name: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${name} doit faire 32 octets (64 caractères hexadécimaux ou base64) — générer avec : openssl rand -base64 32`,
    );
  }
  return key;
}

function keyId(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

let ring: KeyRing | undefined;

function keyRing(): KeyRing {
  if (ring) return ring;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY environment variable is not set");
  const current = decodeKey(raw, "ENCRYPTION_KEY");
  const previousRaw = process.env.ENCRYPTION_KEY_PREVIOUS?.trim();
  const previous = previousRaw ? decodeKey(previousRaw, "ENCRYPTION_KEY_PREVIOUS") : null;
  ring = {
    current: { id: keyId(current), key: current },
    previous: previous ? { id: keyId(previous), key: previous } : null,
  };
  return ring;
}

/** Vérifie la configuration des clés (au démarrage) ; lève une erreur explicite. */
export function assertEncryptionKey(): { currentKeyId: string; previousKeyId: string | null } {
  const { current, previous } = keyRing();
  return { currentKeyId: current.id, previousKeyId: previous?.id ?? null };
}

export function encrypt(plaintext: string): string {
  const { current } = keyRing();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, current.key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `k${current.id}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

type Parsed = { keyId: string | null; iv: Buffer; authTag: Buffer; data: string };

function parse(encrypted: string): Parsed {
  const parts = encrypted.split(":");
  const [keyPart, ivHex, authTagHex, data] =
    parts.length === 4 ? parts : parts.length === 3 ? [null, ...parts] : [null, "", "", ""];
  if (!ivHex || !authTagHex || !data) {
    throw new Error("Invalid encrypted payload format");
  }
  return {
    keyId: keyPart ? keyPart.replace(/^k/, "") : null,
    iv: Buffer.from(ivHex, "hex"),
    authTag: Buffer.from(authTagHex, "hex"),
    data,
  };
}

/** Identifiant de la clé qui a produit un chiffré (`null` pour l'ancien format). */
export function encryptedWithKeyId(encrypted: string): string | null {
  return parse(encrypted).keyId;
}

/** Vrai si le chiffré a été produit avec la clé courante, au format courant. */
export function isCurrentKey(encrypted: string): boolean {
  return encryptedWithKeyId(encrypted) === keyRing().current.id;
}

export function decrypt(encrypted: string): string {
  const { keyId: id, iv, authTag, data } = parse(encrypted);
  const { current, previous } = keyRing();

  // Format courant : la clé est désignée. Ancien format : on essaie la clé
  // courante puis, en rotation, l'ancienne.
  const candidates = id
    ? [current, previous].filter((key): key is Key => key !== null && key.id === id)
    : [current, ...(previous ? [previous] : [])];
  if (candidates.length === 0) {
    throw new Error(`Clé de chiffrement inconnue (${id}) — renseigner ENCRYPTION_KEY_PREVIOUS pour la rotation`);
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, candidate.key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(data, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Déchiffrement impossible");
}

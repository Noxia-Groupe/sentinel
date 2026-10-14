/**
 * Limiteurs de débit en mémoire.
 *
 * L'application tourne dans un conteneur unique derrière Nginx Proxy Manager :
 * un compteur en mémoire suffit. Il protège d'un agent en boucle et ralentit
 * un attaquant ; l'authentification reste la barrière principale.
 *
 * - `checkRateLimit` : par clé d'API (`/api/v1`, `/api/mcp`) ;
 * - `webhookTokenLimiter` : par enregistreur, sur le webhook Dahua (jeton valide) ;
 * - `webhookUnknownLimiter` : par adresse IP, sur les jetons inconnus — c'est
 *   ce qui rend la recherche du jeton par force brute impraticable.
 */

type Window = { count: number; resetAt: number };

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Secondes avant la réinitialisation du compteur. */
  retryAfter: number;
};

/** Entier strictement positif lu dans l'environnement, sinon la valeur par défaut. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, limit: this.limit, remaining: this.limit - 1, retryAfter: 0 };
    }

    current.count += 1;

    // Purge opportuniste : évite que la table enfle avec des clés disparues.
    if (this.windows.size > 1000) {
      for (const [name, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(name);
      }
    }

    return {
      allowed: current.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(this.limit - current.count, 0),
      retryAfter: Math.ceil((current.resetAt - now) / 1000),
    };
  }
}

const apiKeyLimiter = new RateLimiter(
  envInt("API_RATE_LIMIT", 120),
  envInt("API_RATE_WINDOW_MS", 60_000),
);

/** Limitation par clé d'API (`/api/v1`, `/api/mcp`). */
export function checkRateLimit(key: string): RateLimitResult {
  return apiKeyLimiter.check(key);
}

/** Webhook Dahua : appels par minute et par enregistreur (jeton valide). */
export const webhookTokenLimiter = new RateLimiter(envInt("WEBHOOK_RATE_LIMIT", 120), 60_000);

/** Webhook Dahua : jetons inconnus par minute et par adresse IP. */
export const webhookUnknownLimiter = new RateLimiter(
  envInt("WEBHOOK_UNKNOWN_TOKEN_RATE_LIMIT", 20),
  60_000,
);

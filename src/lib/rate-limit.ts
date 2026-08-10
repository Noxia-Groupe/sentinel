/**
 * Limiteur de débit en mémoire, par clé d'API.
 *
 * L'application tourne dans un conteneur unique derrière Nginx Proxy Manager :
 * un compteur en mémoire suffit. Il protège surtout d'un agent en boucle, pas
 * d'un attaquant — l'authentification reste la barrière principale.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

const LIMIT = Number(process.env.API_RATE_LIMIT ?? 120);
const WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS ?? 60_000);

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Secondes avant la réinitialisation du compteur. */
  retryAfter: number;
};

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit: LIMIT, remaining: LIMIT - 1, retryAfter: 0 };
  }

  current.count += 1;
  const remaining = Math.max(LIMIT - current.count, 0);

  // Purge opportuniste : évite que la table enfle avec des clés retirées.
  if (windows.size > 1000) {
    for (const [name, window] of windows) {
      if (window.resetAt <= now) windows.delete(name);
    }
  }

  return {
    allowed: current.count <= LIMIT,
    limit: LIMIT,
    remaining,
    retryAfter: Math.ceil((current.resetAt - now) / 1000),
  };
}

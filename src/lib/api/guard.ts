import { NextResponse } from "next/server";
import { authenticateApiKey, type Scope } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestIp, type Actor } from "@/lib/actor";
import { recordAudit } from "@/lib/audit";

/**
 * Garde d'accès de l'API `/api/v1` : authentification par clé, vérification du
 * scope et limitation de débit. Les erreurs sont renvoyées dans un format
 * stable, pensé pour être compris par un agent automatique.
 */

export type ApiGuard =
  | { ok: true; actor: Actor; scopes: string[] }
  | { ok: false; response: NextResponse };

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export async function requireScope(req: Request, scope: Scope): Promise<ApiGuard> {
  const auth = await authenticateApiKey(req);

  if (!auth.ok) {
    return {
      ok: false,
      response: apiError(
        auth.status,
        auth.status === 401 ? "unauthenticated" : "forbidden",
        auth.error,
      ),
    };
  }

  const rate = checkRateLimit(auth.keyId);
  if (!rate.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "rate_limited",
            message: `Trop de requêtes — limite de ${rate.limit} par minute atteinte.`,
            retryAfter: rate.retryAfter,
          },
        },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      ),
    };
  }

  if (!auth.scopes.includes(scope)) {
    // Une tentative hors périmètre est tracée : c'est un signal utile quand un
    // agent dérive de son rôle.
    await recordAudit({
      actor: auth.actor,
      action: "api.scope_denied",
      targetType: "apikey",
      targetId: auth.keyId,
      success: false,
      metadata: { requiredScope: scope, path: new URL(req.url).pathname },
    });

    return {
      ok: false,
      response: apiError(403, "missing_scope", `Cette clé n'a pas le scope « ${scope} ».`, {
        requiredScope: scope,
        grantedScopes: auth.scopes,
      }),
    };
  }

  return {
    ok: true,
    scopes: auth.scopes,
    actor: { ...auth.actor, ip: requestIp(req) },
  };
}

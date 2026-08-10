import { NextResponse } from "next/server";
import { authenticateApiKey, SCOPES, type Scope } from "@/lib/api-keys";
import { apiError } from "@/lib/api/guard";

// GET /api/v1/me — Identité et permissions de la clé utilisée
export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth.ok) {
    return apiError(auth.status, auth.status === 401 ? "unauthenticated" : "forbidden", auth.error);
  }

  return NextResponse.json({
    keyId: auth.keyId,
    name: auth.actor.label,
    scopes: auth.scopes.map((scope) => ({
      name: scope,
      description: SCOPES[scope as Scope] ?? null,
    })),
  });
}

import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { recordAudit } from "@/lib/audit";
import { checkNvr, nvrHealth } from "@/lib/supervision";

/**
 * GET /api/v1/nvrs/[id]/health — Supervision : anomalies ouvertes, taux de
 * disponibilité (24 h / 7 j) et historique des vérifications (`?limit=`, 50 par défaut).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "nvr:read");
  if (!guard.ok) return guard.response;

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50;
  const health = await nvrHealth((await params).id, limit);
  if (!health) return apiError(404, "not_found", "Enregistreur introuvable");
  return NextResponse.json(health);
}

/** POST /api/v1/nvrs/[id]/health — Vérification immédiate, historisée comme une tournée. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "nvr:test");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await checkNvr(id);
  if (!result) return apiError(404, "not_found", "Enregistreur introuvable");

  await recordAudit({
    actor: guard.actor,
    action: "nvr.health_check",
    targetType: "nvr",
    targetId: id,
    success: result.ok,
    metadata: { message: result.message, openIssues: result.openIssues },
  });

  return NextResponse.json(result);
}

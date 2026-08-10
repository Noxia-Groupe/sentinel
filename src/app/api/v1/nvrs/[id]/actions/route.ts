import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { loadNvr, statusForReason } from "@/lib/dahua/service";
import { executeNvrAction, isNvrAction, NVR_ACTIONS } from "@/lib/dahua/actions";

// GET /api/v1/nvrs/[id]/actions — Catalogue des interventions disponibles
export async function GET(req: Request) {
  const guard = await requireScope(req, "nvr:read");
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    actions: Object.entries(NVR_ACTIONS).map(([name, definition]) => ({ name, ...definition })),
  });
}

/**
 * POST /api/v1/nvrs/[id]/actions — Intervention à distance.
 *
 * Corps : { "action": string, "params"?: object, "credentialId"?: string }
 *
 * Les actions de simple lecture demandent le scope `nvr:test`, celles qui
 * modifient l'état de l'équipement (redémarrage, relais, heure) exigent
 * `nvr:control`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    params?: Record<string, unknown>;
    credentialId?: string;
  };

  if (!isNvrAction(body.action)) {
    return apiError(400, "unknown_action", "Action inconnue", {
      available: Object.entries(NVR_ACTIONS).map(([name, definition]) => ({
        name,
        ...definition,
      })),
    });
  }

  const guard = await requireScope(req, NVR_ACTIONS[body.action].scope);
  if (!guard.ok) return guard.response;

  const nvr = await loadNvr((await params).id);
  if (!nvr) return apiError(404, "not_found", "Enregistreur introuvable");

  const outcome = await executeNvrAction({
    nvr,
    action: body.action,
    params: body.params,
    credentialId: body.credentialId,
    actor: guard.actor,
  });

  if (!outcome.ok) {
    return apiError(statusForReason(outcome.reason), outcome.reason, outcome.message, {
      nvrId: nvr.id,
      action: body.action,
    });
  }

  return NextResponse.json({
    nvr: { id: nvr.id, name: nvr.name },
    action: body.action,
    data: outcome.data,
    executedAt: new Date().toISOString(),
  });
}

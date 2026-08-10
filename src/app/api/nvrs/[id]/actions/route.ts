import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadNvr, statusForReason } from "@/lib/dahua/service";
import { executeNvrAction, isNvrAction, NVR_ACTIONS } from "@/lib/dahua/actions";

// GET /api/nvrs/[id]/actions — Catalogue des interventions disponibles
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  return NextResponse.json(
    Object.entries(NVR_ACTIONS).map(([name, definition]) => ({ name, ...definition })),
  );
}

// POST /api/nvrs/[id]/actions — Exécute une intervention à distance
// Corps : { action: string, credentialId?: string, params?: object }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    credentialId?: string;
    params?: Record<string, unknown>;
  };

  if (!isNvrAction(body.action)) {
    return NextResponse.json(
      {
        error: "Action inconnue",
        available: Object.keys(NVR_ACTIONS),
      },
      { status: 400 },
    );
  }

  const nvr = await loadNvr((await params).id);
  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  const outcome = await executeNvrAction({
    nvr,
    action: body.action,
    params: body.params,
    credentialId: body.credentialId,
    actor: guard.actor,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.message, reason: outcome.reason },
      { status: statusForReason(outcome.reason) },
    );
  }

  return NextResponse.json({ action: body.action, data: outcome.data });
}

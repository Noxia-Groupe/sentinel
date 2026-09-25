import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { checkNvr, nvrHealth } from "@/lib/supervision";

type Params = { params: Promise<{ id: string }> };

// GET /api/nvrs/[id]/health — État de supervision, disponibilité et historique
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const health = await nvrHealth((await params).id);
  if (!health) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });
  return NextResponse.json(health);
}

// POST /api/nvrs/[id]/health — Vérification immédiate (même contrôle que la supervision)
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await checkNvr(id);
  if (!result) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });

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

// PATCH /api/nvrs/[id]/health — Inclut ou exclut l'enregistreur de la supervision
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.monitored !== "boolean") {
    return NextResponse.json({ error: "Champ « monitored » (booléen) attendu" }, { status: 400 });
  }

  const existing = await prisma.nvr.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });

  const nvr = await prisma.nvr.update({
    where: { id },
    // Sortir de la supervision efface l'état courant : il serait périmé au retour.
    data: body.monitored
      ? { monitored: true }
      : { monitored: false, healthIssues: [], consecutiveFailures: 0 },
    select: { id: true, monitored: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: body.monitored ? "nvr.monitoring_on" : "nvr.monitoring_off",
    targetType: "nvr",
    targetId: id,
  });

  return NextResponse.json(nvr);
}

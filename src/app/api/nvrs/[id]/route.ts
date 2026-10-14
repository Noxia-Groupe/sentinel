import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireOperator, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { isReachable } from "@/lib/dahua/service";
import { p2pStatus } from "@/lib/dahua/p2p";
import { checkNvrHost } from "@/lib/nvr-address";
import { LIMITS, clip } from "@/lib/validate";

const NVR_STATUSES = new Set(["unknown", "online", "offline"]);

// GET /api/nvrs/[id] — Détail d'un enregistreur
//
// Les mots de passe ne sont jamais renvoyés ici : leur lecture passe par
// `POST /api/nvrs/[id]/credentials/[credId]/reveal`, qui laisse une trace.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const nvr = await prisma.nvr.findUnique({
    where: { id: (await params).id },
    include: {
      client: { select: { id: true, name: true, code: true } },
      credentials: {
        select: {
          id: true,
          type: true,
          username: true,
          label: true,
          lastTestedAt: true,
          lastTestOk: true,
          rights: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      events: {
        orderBy: { receivedAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          severity: true,
          status: true,
          channel: true,
          payload: true,
          receivedAt: true,
        },
      },
      checks: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          success: true,
          latencyMs: true,
          message: true,
          actorLabel: true,
          createdAt: true,
        },
      },
    },
  });

  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  return NextResponse.json({
    ...nvr,
    // L'interface s'appuie dessus pour activer les tests et les interventions :
    // en P2P, cela dépend de la disponibilité du tunnel sur cette instance.
    reachable: isReachable(nvr),
    p2p: p2pStatus(),
  });
}

// PUT /api/nvrs/[id] — Met à jour un enregistreur
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.ip === "string" && body.ip.trim()) {
    const check = checkNvrHost(body.ip);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const nvr = await prisma.nvr.update({
    where: { id },
    data: {
      ...(clip(body.name, LIMITS.name) ? { name: clip(body.name, LIMITS.name)! } : {}),
      ...(body.clientId !== undefined
        ? { clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null }
        : {}),
      ...(body.ip !== undefined ? { ip: clip(body.ip, LIMITS.host) } : {}),
      ...(body.port !== undefined ? { port: toPort(body.port, 37777) } : {}),
      ...(body.httpPort !== undefined ? { httpPort: toPort(body.httpPort, 80) } : {}),
      ...(body.rtspPort !== undefined ? { rtspPort: toPort(body.rtspPort, 554) } : {}),
      ...(typeof body.useHttps === "boolean" ? { useHttps: body.useHttps } : {}),
      ...(body.serialNumber !== undefined ? { serialNumber: clip(body.serialNumber, LIMITS.serial) } : {}),
      ...(body.model !== undefined ? { model: clip(body.model, LIMITS.model) } : {}),
      ...(body.location !== undefined ? { location: clip(body.location, LIMITS.location) } : {}),
      ...(body.notes !== undefined ? { notes: clip(body.notes, LIMITS.notes) } : {}),
      ...(typeof body.status === "string" && NVR_STATUSES.has(body.status) ? { status: body.status } : {}),
      ...(body.connectionMode === "ip" || body.connectionMode === "p2p"
        ? { connectionMode: body.connectionMode }
        : {}),
      ...(body.p2pSerial !== undefined ? { p2pSerial: clip(body.p2pSerial, LIMITS.serial) } : {}),
    },
  });

  await recordAudit({
    actor: guard.actor,
    action: "nvr.update",
    targetType: "nvr",
    targetId: id,
  });

  return NextResponse.json(nvr);
}

// DELETE /api/nvrs/[id] — Supprime un enregistreur et son historique
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  await prisma.nvr.delete({ where: { id } });

  await recordAudit({
    actor: guard.actor,
    action: "nvr.delete",
    targetType: "nvr",
    targetId: id,
  });

  return NextResponse.json({ success: true });
}

function toPort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

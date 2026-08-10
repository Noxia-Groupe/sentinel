import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";
import { NVR_ACTIONS } from "@/lib/dahua/actions";

// GET /api/v1/nvrs/[id] — Fiche complète d'un enregistreur
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "nvr:read");
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
        },
      },
      checks: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { success: true, latencyMs: true, message: true, createdAt: true, actorLabel: true },
      },
      _count: {
        select: { events: { where: { status: { in: ["new", "acknowledged", "in_progress"] } } } },
      },
    },
  });

  if (!nvr) return apiError(404, "not_found", "Enregistreur introuvable");

  return NextResponse.json({
    id: nvr.id,
    name: nvr.name,
    client: nvr.client,
    ip: nvr.ip,
    httpPort: nvr.httpPort,
    useHttps: nvr.useHttps,
    sdkPort: nvr.port,
    connectionMode: nvr.connectionMode,
    p2pSerial: nvr.p2pSerial,
    serialNumber: nvr.serialNumber,
    model: nvr.model,
    firmware: nvr.firmware,
    location: nvr.location,
    notes: nvr.notes,
    status: nvr.status,
    lastSeen: nvr.lastSeen,
    lastCheck: { at: nvr.lastCheckAt, ok: nvr.lastCheckOk, message: nvr.lastCheckMessage },
    credentials: nvr.credentials,
    recentChecks: nvr.checks,
    openAlarms: nvr._count.events,
    reachable: nvr.connectionMode !== "p2p" && Boolean(nvr.ip),
    availableActions: Object.entries(NVR_ACTIONS).map(([name, definition]) => ({
      name,
      ...definition,
    })),
  });
}

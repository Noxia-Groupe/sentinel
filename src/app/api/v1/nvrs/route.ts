import { NextResponse } from "next/server";
import { requireScope } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";

// GET /api/v1/nvrs — Inventaire des enregistreurs
// Filtres : ?clientId= &status= &search=
export async function GET(req: Request) {
  const guard = await requireScope(req, "nvr:read");
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");

  const nvrs = await prisma.nvr.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { ip: { contains: search, mode: "insensitive" as const } },
              { location: { contains: search, mode: "insensitive" as const } },
              { serialNumber: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: {
      client: { select: { id: true, name: true, code: true } },
      credentials: { select: { id: true, type: true, username: true, lastTestOk: true } },
      _count: {
        select: { events: { where: { status: { in: ["new", "acknowledged", "in_progress"] } } } },
      },
    },
  });

  return NextResponse.json({
    nvrs: nvrs.map((nvr) => ({
      id: nvr.id,
      name: nvr.name,
      client: nvr.client,
      ip: nvr.ip,
      httpPort: nvr.httpPort,
      useHttps: nvr.useHttps,
      connectionMode: nvr.connectionMode,
      serialNumber: nvr.serialNumber,
      model: nvr.model,
      firmware: nvr.firmware,
      location: nvr.location,
      status: nvr.status,
      lastSeen: nvr.lastSeen,
      lastCheck: {
        at: nvr.lastCheckAt,
        ok: nvr.lastCheckOk,
        message: nvr.lastCheckMessage,
      },
      // Les mots de passe ne sont pas exposés ici : voir l'endpoint `reveal`.
      credentials: nvr.credentials,
      openAlarms: nvr._count.events,
      // Un enregistreur en P2P n'est pas joignable directement par la plateforme.
      reachable: nvr.connectionMode !== "p2p" && Boolean(nvr.ip),
    })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const CONNECTED_WINDOW_MS = 15 * 60_000;

// GET /api/hermes/status — Liaison Hermes dans les deux sens : clés MCP
// (dernière utilisation, dernières actions de l'agent) et webhook qui réveille
// Hermes (dernier envoi).
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const keys = await prisma.apiKey.findMany({
    where: { revokedAt: null, name: { contains: "hermes", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
  });

  const activity = keys.length
    ? await prisma.auditLog.findMany({
        where: { actorType: "apikey", actorId: { in: keys.map((key) => key.id) } },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, actorId: true, action: true, targetType: true, targetId: true, success: true, createdAt: true },
      })
    : [];

  // Sens Sentinel → Hermes : le webhook de la connexion en une étape et son dernier envoi.
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { name: "Hermes Agent" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      url: true,
      enabled: true,
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { eventType: true, status: true, lastStatus: true, lastError: true, createdAt: true, deliveredAt: true },
      },
    },
  });

  const now = Date.now();
  return NextResponse.json({
    keys: keys.map((key) => ({
      ...key,
      expired: key.expiresAt !== null && key.expiresAt.getTime() < now,
      connected: key.lastUsedAt !== null && now - key.lastUsedAt.getTime() < CONNECTED_WINDOW_MS,
      canIntervene: key.scopes.includes("nvr:control"),
    })),
    activity,
    webhook: endpoint
      ? { id: endpoint.id, url: endpoint.url, enabled: endpoint.enabled, lastDelivery: endpoint.deliveries[0] ?? null }
      : null,
  });
}

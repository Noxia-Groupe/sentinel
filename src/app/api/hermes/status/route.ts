import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const CONNECTED_WINDOW_MS = 15 * 60_000;

// GET /api/hermes/status — Clés de connexion Hermes, dernière utilisation et
// dernières actions menées par l'agent (journal d'audit).
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

  const now = Date.now();
  return NextResponse.json({
    keys: keys.map((key) => ({
      ...key,
      expired: key.expiresAt !== null && key.expiresAt.getTime() < now,
      connected: key.lastUsedAt !== null && now - key.lastUsedAt.getTime() < CONNECTED_WINDOW_MS,
      canIntervene: key.scopes.includes("nvr:control"),
    })),
    activity,
  });
}

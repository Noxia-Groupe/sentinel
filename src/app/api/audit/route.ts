import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/audit — Journal d'audit (réservé aux superadmins)
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const action = url.searchParams.get("action") ?? undefined;
  const targetId = url.searchParams.get("targetId") ?? undefined;
  const actorType = url.searchParams.get("actorType") ?? undefined;

  const entries = await prisma.auditLog.findMany({
    where: {
      ...(action ? { action } : {}),
      ...(targetId ? { targetId } : {}),
      ...(actorType ? { actorType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(entries);
}

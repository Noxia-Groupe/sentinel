import { NextResponse } from "next/server";
import { requireScope } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";
import { alarmStats } from "@/lib/alarm-service";

// GET /api/v1/stats — Vue d'ensemble du parc et des alarmes en cours
export async function GET(req: Request) {
  const guard = await requireScope(req, "alarms:read");
  if (!guard.ok) return guard.response;

  const [alarms, nvrTotal, nvrOnline, nvrOffline, clients] = await Promise.all([
    alarmStats(),
    prisma.nvr.count(),
    prisma.nvr.count({ where: { status: "online" } }),
    prisma.nvr.count({ where: { status: "offline" } }),
    prisma.client.count(),
  ]);

  return NextResponse.json({
    alarms,
    nvrs: { total: nvrTotal, online: nvrOnline, offline: nvrOffline },
    clients,
    generatedAt: new Date().toISOString(),
  });
}

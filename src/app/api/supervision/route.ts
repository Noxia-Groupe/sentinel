import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  SUPERVISION_LIMITS,
  getSupervisionConfig,
  isCycleRunning,
  updateSupervisionConfig,
} from "@/lib/supervision";
import { supervisionDefinition, type SupervisionIssue } from "@/lib/dahua/events";

// GET /api/supervision — Réglages, dernière tournée et enregistreurs en anomalie
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const [config, monitored, total, withIssues] = await Promise.all([
    getSupervisionConfig(),
    prisma.nvr.count({ where: { monitored: true } }),
    prisma.nvr.count(),
    prisma.nvr.findMany({
      where: { monitored: true, NOT: { healthIssues: { isEmpty: true } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, healthIssues: true, client: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    config,
    limits: SUPERVISION_LIMITS,
    running: isCycleRunning(),
    nvrs: { total, monitored },
    issues: withIssues.map((nvr) => ({
      id: nvr.id,
      name: nvr.name,
      client: nvr.client?.name ?? null,
      issues: (nvr.healthIssues as SupervisionIssue[]).map((issue) => supervisionDefinition(issue).title),
    })),
  });
}

// PATCH /api/supervision — Modifie les réglages (activation, intervalle, seuils)
export async function PATCH(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const config = await updateSupervisionConfig(body);

  await recordAudit({
    actor: guard.actor,
    action: "supervision.configure",
    targetType: "system",
    metadata: {
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      offlineThreshold: config.offlineThreshold,
      clockDriftMinutes: config.clockDriftMinutes,
    },
  });

  return NextResponse.json(config);
}

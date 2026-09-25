import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { triggerSupervisionCycle } from "@/lib/supervision";

// POST /api/supervision/run — Lance immédiatement une tournée de vérification
export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const started = triggerSupervisionCycle();
  if (!started) {
    return NextResponse.json({ error: "Une tournée est déjà en cours" }, { status: 409 });
  }

  await recordAudit({ actor: guard.actor, action: "supervision.run", targetType: "system" });
  return NextResponse.json({ started: true }, { status: 202 });
}

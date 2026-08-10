import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { alarmStats, listEvents, parseEventFilters } from "@/lib/alarm-service";

// GET /api/events — Flux d'alarmes filtrable (statut, criticité, client, NVR…)
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const filters = parseEventFilters(new URL(req.url));
  const [page, stats] = await Promise.all([listEvents(filters), alarmStats()]);

  return NextResponse.json({ ...page, stats });
}

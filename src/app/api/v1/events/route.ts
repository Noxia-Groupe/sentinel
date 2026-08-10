import { NextResponse } from "next/server";
import { requireScope } from "@/lib/api/guard";
import { alarmStats, listEvents, parseEventFilters } from "@/lib/alarm-service";
import { EVENT_STATUSES, SEVERITIES } from "@/lib/dahua/events";

/**
 * GET /api/v1/events — Flux d'alarmes.
 *
 * Filtres (répétables ou séparés par des virgules) :
 *   status, severity, clientId, nvrId, type, since, until, search, limit, offset
 *
 * Exemple : `/api/v1/events?status=new&severity=critical,major&limit=20`
 */
export async function GET(req: Request) {
  const guard = await requireScope(req, "alarms:read");
  if (!guard.ok) return guard.response;

  const filters = parseEventFilters(new URL(req.url));
  const [page, stats] = await Promise.all([listEvents(filters), alarmStats()]);

  return NextResponse.json({
    ...page,
    stats,
    filters: {
      applied: {
        status: filters.status,
        severity: filters.severity,
        clientId: filters.clientId,
        nvrId: filters.nvrId,
        type: filters.type,
        since: filters.since?.toISOString(),
        until: filters.until?.toISOString(),
        search: filters.search,
      },
      available: { status: EVENT_STATUSES, severity: SEVERITIES },
    },
  });
}

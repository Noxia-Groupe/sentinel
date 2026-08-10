import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { getEvent, updateEvent, type EventUpdate } from "@/lib/alarm-service";
import { EVENT_STATUSES, isEventStatus } from "@/lib/dahua/events";

// GET /api/v1/events/[id] — Alarme et sa main courante
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "alarms:read");
  if (!guard.ok) return guard.response;

  const event = await getEvent((await params).id);
  if (!event) return apiError(404, "not_found", "Alarme introuvable");

  return NextResponse.json(event);
}

/**
 * PATCH /api/v1/events/[id] — Traitement d'une alarme.
 *
 * Corps : { "status"?: "new"|"acknowledged"|"in_progress"|"resolved"|"ignored",
 *           "resolution"?: string, "comment"?: string, "assignedToId"?: string|null }
 *
 * La prise en compte et la clôture sont horodatées automatiquement, et
 * attribuées au nom de la clé d'API utilisée.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "alarms:write");
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.status !== undefined && !isEventStatus(body.status)) {
    return apiError(400, "invalid_status", "Statut invalide", { allowed: EVENT_STATUSES });
  }

  const update: EventUpdate = {
    status: isEventStatus(body.status) ? body.status : undefined,
    resolution: typeof body.resolution === "string" ? body.resolution : undefined,
    assignedToId:
      body.assignedToId === null
        ? null
        : typeof body.assignedToId === "string"
          ? body.assignedToId
          : undefined,
    comment:
      typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : undefined,
  };

  if (!update.status && update.resolution === undefined && update.assignedToId === undefined && !update.comment) {
    return apiError(400, "empty_update", "Aucun champ modifiable fourni");
  }

  const event = await updateEvent((await params).id, update, guard.actor);
  if (!event) return apiError(404, "not_found", "Alarme introuvable");

  return NextResponse.json(event);
}

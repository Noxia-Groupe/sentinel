import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getEvent, updateEvent, type EventUpdate } from "@/lib/alarm-service";
import { isEventStatus } from "@/lib/dahua/events";

// GET /api/events/[id] — Détail d'une alarme et sa main courante
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const event = await getEvent((await params).id);
  if (!event) return NextResponse.json({ error: "Alarme introuvable" }, { status: 404 });

  return NextResponse.json(event);
}

// PATCH /api/events/[id] — Traitement : statut, affectation, motif de clôture
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.status !== undefined && !isEventStatus(body.status)) {
    return NextResponse.json(
      { error: "Statut invalide (new, acknowledged, in_progress, resolved, ignored)" },
      { status: 400 },
    );
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
    comment: typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : undefined,
  };

  const event = await updateEvent((await params).id, update, guard.actor);
  if (!event) return NextResponse.json({ error: "Alarme introuvable" }, { status: 404 });

  return NextResponse.json(event);
}

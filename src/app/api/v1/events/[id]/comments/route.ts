import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";
import { addComment } from "@/lib/alarm-service";

// POST /api/v1/events/[id]/comments — Ajoute une entrée à la main courante
// Corps : { "body": string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "alarms:write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof payload.body === "string" ? payload.body.trim() : "";

  if (!text) return apiError(400, "empty_comment", "Le champ `body` est requis");

  const exists = await prisma.nvrEvent.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return apiError(404, "not_found", "Alarme introuvable");

  return NextResponse.json(await addComment(id, text, guard.actor), { status: 201 });
}

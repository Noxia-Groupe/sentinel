import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { addComment } from "@/lib/alarm-service";

// POST /api/events/[id]/comments — Ajoute une entrée à la main courante
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Le commentaire est vide" }, { status: 400 });
  }

  const exists = await prisma.nvrEvent.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Alarme introuvable" }, { status: 404 });

  return NextResponse.json(await addComment(id, text, guard.actor), { status: 201 });
}

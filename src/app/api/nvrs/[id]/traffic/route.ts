import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { liveRate, nvrTraffic } from "@/lib/traffic";
import { supervisionCost } from "@/lib/supervision";

// GET /api/nvrs/:id/traffic — Trafic échangé par Sentinel avec l'enregistreur
// (débit en cours, volumes 24 h / 7 j par origine, heure par heure) et coût
// observé de la supervision automatique. `?live=1` : débit en cours seul.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const exists = await prisma.nvr.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });
  // ?live=1 : débit en cours seulement (en-tête de la fiche, rafraîchi souvent).
  if (new URL(req.url).searchParams.get("live") === "1") {
    return NextResponse.json({ live: liveRate(id) }, { headers: { "Cache-Control": "no-store" } });
  }
  const [traffic, supervision] = await Promise.all([nvrTraffic(id), supervisionCost(id)]);
  return NextResponse.json({ ...traffic, supervision }, { headers: { "Cache-Control": "no-store" } });
}

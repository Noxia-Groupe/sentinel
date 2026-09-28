import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { fleetTraffic } from "@/lib/traffic";

// GET /api/nvrs/traffic — Débit en cours et volume 24 h de chaque enregistreur
// (trafic échangé par Sentinel). Interrogée périodiquement par la liste.
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;
  return NextResponse.json(await fleetTraffic(), { headers: { "Cache-Control": "no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/webhooks/dahua/[token] — Reçoit les événements Alarm Center Dahua
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Trouver le NVR par son token webhook
  const nvr = await prisma.nvr.findUnique({
    where: { webhookToken: token },
  });

  if (!nvr) {
    return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });
  }

  // Lire le corps (Dahua envoie généralement du JSON ou du XML/URL-encoded)
  let payload: unknown;
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    payload = await req.json();
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    payload = Object.fromEntries(params.entries());
  } else {
    payload = await req.text();
  }

  // Extraire le type d'événement
  let eventType = "unknown";
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    eventType = (p.event as string) || (p.type as string) || (p.AlarmType as string) || "unknown";
  }

  // Enregistrer l'événement
  await prisma.nvrEvent.create({
    data: {
      nvrId: nvr.id,
      type: eventType,
      payload: payload as object,
    },
  });

  // Mettre à jour le statut et lastSeen
  await prisma.nvr.update({
    where: { id: nvr.id },
    data: {
      status: "online",
      lastSeen: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { sendTestDelivery } from "@/lib/outbound-webhooks";

// POST /api/outbound-webhooks/[id]/test — Envoie un événement `sentinel.test` et attend la réponse
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { enabled: true } });
  if (!endpoint) return NextResponse.json({ error: "Webhook introuvable" }, { status: 404 });
  if (!endpoint.enabled) {
    return NextResponse.json({ error: "Webhook désactivé : l'activer avant de le tester" }, { status: 409 });
  }

  const result = await sendTestDelivery(id, guard.email || guard.actor.label);

  await recordAudit({
    actor: guard.actor,
    action: "webhook.test",
    targetType: "webhook",
    targetId: id,
    success: result.ok,
    metadata: { status: result.status, error: result.error },
  });

  return NextResponse.json(result);
}

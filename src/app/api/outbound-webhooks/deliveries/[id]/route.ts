import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { deliver } from "@/lib/outbound-webhooks";

// POST /api/outbound-webhooks/deliveries/[id] — Renvoie une livraison en échec
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const reset = await prisma.webhookDelivery.updateMany({
    where: { id, status: "failed" },
    data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (reset.count !== 1) {
    return NextResponse.json({ error: "Seule une livraison en échec peut être renvoyée" }, { status: 409 });
  }

  const result = await deliver(id);

  await recordAudit({
    actor: guard.actor,
    action: "webhook.redeliver",
    targetType: "webhook",
    targetId: id,
    success: result.ok,
    metadata: { status: result.status, error: result.error },
  });

  return NextResponse.json(result);
}

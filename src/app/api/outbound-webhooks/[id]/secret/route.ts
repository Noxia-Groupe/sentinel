import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { encryptSecret, generateWebhookSecret } from "@/lib/outbound-webhooks";

// POST /api/outbound-webhooks/[id]/secret — Régénère le secret de signature (affiché une fois)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Webhook introuvable" }, { status: 404 });

  const secret = generateWebhookSecret();
  await prisma.webhookEndpoint.update({ where: { id }, data: { secretEncrypted: encryptSecret(secret) } });

  await recordAudit({
    actor: guard.actor,
    action: "webhook.rotate_secret",
    targetType: "webhook",
    targetId: id,
  });

  return NextResponse.json({ secret });
}

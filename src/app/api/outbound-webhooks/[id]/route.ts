import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { validateWebhookUrl } from "@/lib/outbound-webhooks";
import { parseWebhookSettings, publicEndpoint } from "@/lib/webhook-config";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/outbound-webhooks/[id] — Modifie les réglages ou active / désactive
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Webhook introuvable" }, { status: 404 });

  const settings = parseWebhookSettings((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (settings.name !== undefined && !settings.name) {
    return NextResponse.json({ error: "Le nom du webhook est requis" }, { status: 400 });
  }
  if (settings.url !== undefined) {
    const checked = validateWebhookUrl(settings.url);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    settings.url = checked.url;
  }

  const endpoint = await prisma.webhookEndpoint.update({ where: { id }, data: settings });

  await recordAudit({
    actor: guard.actor,
    action: "webhook.update",
    targetType: "webhook",
    targetId: id,
    metadata: { changes: Object.keys(settings), enabled: endpoint.enabled },
  });

  return NextResponse.json(publicEndpoint(endpoint));
}

// DELETE /api/outbound-webhooks/[id] — Supprime le webhook et son historique
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { name: true, url: true } });
  if (!existing) return NextResponse.json({ error: "Webhook introuvable" }, { status: 404 });

  await prisma.webhookEndpoint.delete({ where: { id } });

  await recordAudit({
    actor: guard.actor,
    action: "webhook.delete",
    targetType: "webhook",
    targetId: id,
    metadata: existing,
  });

  return NextResponse.json({ success: true });
}

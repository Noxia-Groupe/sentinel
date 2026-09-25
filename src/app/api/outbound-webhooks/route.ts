import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { encryptSecret, generateWebhookSecret, validateWebhookUrl } from "@/lib/outbound-webhooks";
import { WEBHOOK_OPTIONS, parseWebhookSettings, publicEndpoint } from "@/lib/webhook-config";
import { CATEGORY_LABELS, SEVERITY_LABELS } from "@/lib/dahua/events";

// GET /api/outbound-webhooks — Webhooks sortants, dernières livraisons et options de filtre
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const [endpoints, deliveries, clients] = await Promise.all([
    prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.webhookDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        endpointId: true,
        eventType: true,
        status: true,
        attempts: true,
        lastStatus: true,
        lastError: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
        payload: true,
      },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return NextResponse.json({
    endpoints: endpoints.map(publicEndpoint),
    deliveries: deliveries.map(({ payload, ...delivery }) => ({
      ...delivery,
      summary: (payload as { summary?: string } | null)?.summary ?? null,
    })),
    options: {
      severities: WEBHOOK_OPTIONS.severities.map((value) => ({ value, label: SEVERITY_LABELS[value] })),
      categories: WEBHOOK_OPTIONS.categories.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
      clients,
    },
  });
}

// POST /api/outbound-webhooks — Crée un webhook ; le secret n'est renvoyé qu'ici
export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const settings = parseWebhookSettings(body);

  if (!settings.name) {
    return NextResponse.json({ error: "Le nom du webhook est requis" }, { status: 400 });
  }
  const checked = validateWebhookUrl(settings.url ?? "");
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const secret = generateWebhookSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      name: settings.name,
      url: checked.url,
      secretEncrypted: encryptSecret(secret),
      enabled: settings.enabled ?? true,
      severities: settings.severities ?? [],
      categories: settings.categories ?? [],
      clientIds: settings.clientIds ?? [],
      notifyStatusChanges: settings.notifyStatusChanges ?? false,
      notifyNvrStatus: settings.notifyNvrStatus ?? true,
      createdBy: guard.email,
    },
  });

  await recordAudit({
    actor: guard.actor,
    action: "webhook.create",
    targetType: "webhook",
    targetId: endpoint.id,
    metadata: { name: endpoint.name, url: endpoint.url },
  });

  // Unique occasion de récupérer le secret en clair.
  return NextResponse.json({ ...publicEndpoint(endpoint), secret }, { status: 201 });
}

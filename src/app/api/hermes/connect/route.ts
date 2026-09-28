import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { generateApiKey } from "@/lib/api-keys";
import { encryptSecret, generateWebhookSecret, validateWebhookUrl } from "@/lib/outbound-webhooks";

/** Nom du webhook géré par la connexion en une étape. */
const HERMES_ENDPOINT_NAME = "Hermes Agent";

const READ_SCOPES = ["alarms:read", "alarms:write", "nvr:read", "nvr:test"];

// POST /api/hermes/connect — Connexion Hermes en une étape.
//
// Crée (ou renouvelle) d'un coup la clé MCP de Hermes et le webhook qui le
// réveille, et renvoie les deux secrets pour un bloc de configuration unique.
// Rejouable : les anciennes clés Hermes sont révoquées, le webhook existant
// garde ses filtres et ses consignes (seuls l'URL et le secret changent).
export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowControl = body.allowControl === true;
  const rawUrl = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";

  let webhookUrl: string | null = null;
  if (rawUrl) {
    const checked = validateWebhookUrl(rawUrl);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    webhookUrl = checked.url;
  }

  // 1. Clé MCP (les précédentes clés Hermes sont révoquées : une seule connexion).
  const revoked = await prisma.apiKey.updateMany({
    where: { revokedAt: null, name: { startsWith: "Hermes Agent" } },
    data: { revokedAt: new Date() },
  });
  const generated = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      name: allowControl ? "Hermes Agent (supervision + interventions)" : "Hermes Agent (supervision)",
      prefix: generated.prefix,
      hash: generated.hash,
      scopes: allowControl ? [...READ_SCOPES, "nvr:control"] : READ_SCOPES,
      createdById: guard.actor.id ?? null,
    },
    select: { id: true, name: true, prefix: true, scopes: true },
  });

  // 2. Webhook qui réveille Hermes (facultatif).
  let endpoint: { id: string; url: string } | null = null;
  let webhookSecret: string | null = null;
  if (webhookUrl) {
    webhookSecret = generateWebhookSecret();
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { name: HERMES_ENDPOINT_NAME },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    endpoint = existing
      ? await prisma.webhookEndpoint.update({
          where: { id: existing.id },
          data: { url: webhookUrl, secretEncrypted: encryptSecret(webhookSecret), enabled: true },
          select: { id: true, url: true },
        })
      : await prisma.webhookEndpoint.create({
          data: {
            name: HERMES_ENDPOINT_NAME,
            url: webhookUrl,
            secretEncrypted: encryptSecret(webhookSecret),
            // Par défaut : alarmes critiques et majeures, pannes d'enregistreur.
            severities: ["critical", "major"],
            categories: [],
            clientIds: [],
            notifyStatusChanges: false,
            notifyNvrStatus: true,
            createdBy: guard.email,
          },
          select: { id: true, url: true },
        });
  }

  await recordAudit({
    actor: guard.actor,
    action: "hermes.connect",
    targetType: "apikey",
    targetId: key.id,
    metadata: {
      scopes: key.scopes,
      revokedPreviousKeys: revoked.count,
      webhookId: endpoint?.id ?? null,
      webhookUrl: endpoint?.url ?? null,
    },
  });

  // Unique occasion de récupérer les secrets en clair.
  return NextResponse.json(
    { key: { ...key, secret: generated.secret }, webhook: endpoint ? { ...endpoint, secret: webhookSecret } : null },
    { status: 201 },
  );
}

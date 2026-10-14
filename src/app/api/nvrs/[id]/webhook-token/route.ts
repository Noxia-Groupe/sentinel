import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { loadNvr, runNvrAction, statusForReason } from "@/lib/dahua/service";
import {
  configureAlarmCenter,
  type AlarmCenterResult,
  type AlarmScheme,
} from "@/lib/dahua/alarm-center";
import { generateWebhookToken } from "@/lib/webhook-token";

/**
 * POST /api/nvrs/[id]/webhook-token — Régénère le jeton du webhook.
 *
 * Corps : { provision?: boolean (défaut true), scheme?: "http" | "https", credentialId?: string }
 *
 * Le jeton est l'unique secret qui authentifie l'enregistreur : le régénérer
 * invalide l'ancienne URL. Par défaut, la nouvelle adresse est d'abord écrite
 * sur l'enregistreur (même mécanique que « Déclarer SENTINEL ») et le jeton
 * n'est retenu en base que si cette écriture aboutit — un NVR injoignable
 * garde son jeton. Avec `provision: false`, le jeton change immédiatement et
 * l'enregistreur doit être reconfiguré à la main avec la nouvelle URL.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const provision = body.provision !== false;
  const scheme: AlarmScheme | undefined =
    body.scheme === "http" || body.scheme === "https" ? body.scheme : undefined;
  const credentialId =
    typeof body.credentialId === "string" && body.credentialId ? body.credentialId : undefined;

  const nvr = await loadNvr(id);
  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  const webhookToken = generateWebhookToken();
  let provisioning: AlarmCenterResult | null = null;

  if (provision) {
    const outcome = await runNvrAction({
      nvr,
      credentialId,
      action: "nvr.webhook_token_rotate",
      actor: guard.actor,
      metadata: { provision: true, scheme: scheme ?? "https" },
      run: (target) => configureAlarmCenter({ target, webhookToken, scheme }),
    });
    if (!outcome.ok) {
      return NextResponse.json(
        {
          error:
            "Jeton conservé : impossible d'écrire la nouvelle adresse sur l'enregistreur — " +
            outcome.message,
          reason: outcome.reason,
        },
        { status: statusForReason(outcome.reason) },
      );
    }
    provisioning = outcome.data;
  }

  await prisma.nvr.update({ where: { id }, data: { webhookToken } });

  if (!provision) {
    await recordAudit({
      actor: guard.actor,
      action: "nvr.webhook_token_rotate",
      targetType: "nvr",
      targetId: id,
      metadata: { provision: false },
    });
  }

  return NextResponse.json({ webhookToken, provisioning });
}

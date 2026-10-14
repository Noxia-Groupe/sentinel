import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

/**
 * DELETE /api/nvrs/[id]/tls-pin — Oublie l'empreinte TLS épinglée.
 *
 * Réservé aux administrateurs : à n'utiliser qu'après avoir vérifié que
 * l'enregistreur a réellement changé de certificat (firmware, régénération).
 * Le prochain contact HTTPS épingle le certificat alors présenté.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const nvr = await prisma.nvr.findUnique({ where: { id }, select: { id: true, tlsFingerprint: true } });
  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  await prisma.nvr.update({ where: { id }, data: { tlsFingerprint: null } });

  await recordAudit({
    actor: guard.actor,
    action: "nvr.tls_pin_reset",
    targetType: "nvr",
    targetId: id,
    metadata: { previous: nvr.tlsFingerprint },
  });

  return NextResponse.json({ success: true });
}

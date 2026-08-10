import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { revealCredential } from "@/lib/credentials";

/**
 * POST /api/v1/nvrs/[id]/credentials/[credId]/reveal — Mot de passe en clair.
 *
 * Corps : { "reason"?: string } — le motif est enregistré dans le journal
 * d'audit à côté de l'identité de la clé.
 *
 * Réservé au scope `credentials:read`, à n'accorder qu'aux intégrations qui en
 * ont réellement besoin : c'est le seul endpoint qui sort un secret.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; credId: string }> },
) {
  const guard = await requireScope(req, "credentials:read");
  if (!guard.ok) return guard.response;

  const { id, credId } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };

  try {
    const credential = await revealCredential({
      nvrId: id,
      credentialId: credId,
      actor: guard.actor,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });

    if (!credential) return apiError(404, "not_found", "Compte introuvable pour cet enregistreur");

    return NextResponse.json(credential);
  } catch (error) {
    return apiError(
      500,
      "decrypt_failed",
      error instanceof Error ? error.message : "Déchiffrement impossible",
    );
  }
}

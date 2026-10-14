import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { RevealQuotaError, revealCredential } from "@/lib/credentials";
import { LIMITS, clip } from "@/lib/validate";

// POST /api/nvrs/[id]/credentials/[credId]/reveal — Affiche un mot de passe en clair
//
// Volontairement en POST : la lecture d'un secret est une action, elle laisse
// une trace nominative dans le journal d'audit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credId: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const { id, credId } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };

  try {
    const credential = await revealCredential({
      nvrId: id,
      credentialId: credId,
      actor: guard.actor,
      reason: clip(body.reason, LIMITS.reason) ?? undefined,
    });

    if (!credential) {
      return NextResponse.json({ error: "Compte non trouvé" }, { status: 404 });
    }

    return NextResponse.json(credential);
  } catch (error) {
    if (error instanceof RevealQuotaError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Déchiffrement impossible" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { revealCredential } from "@/lib/credentials";

// POST /api/nvrs/[id]/credentials/[credId]/reveal — Affiche un mot de passe en clair
//
// Volontairement en POST : la lecture d'un secret est une action, elle laisse
// une trace nominative dans le journal d'audit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credId: string }> },
) {
  const guard = await requireUser(req);
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

    if (!credential) {
      return NextResponse.json({ error: "Compte non trouvé" }, { status: 404 });
    }

    return NextResponse.json(credential);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Déchiffrement impossible" },
      { status: 500 },
    );
  }
}

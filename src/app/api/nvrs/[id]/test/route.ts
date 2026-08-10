import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadNvr, testAllCredentials, testNvrConnection } from "@/lib/dahua/service";

// POST /api/nvrs/[id]/test — Teste la connexion avec un compte enregistré
// Corps : { credentialId?: string, all?: boolean }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const nvr = await loadNvr((await params).id);
  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { credentialId?: string; all?: boolean };

  if (body.all) {
    const results = await testAllCredentials({ nvr, actor: guard.actor });
    return NextResponse.json({ results });
  }

  const result = await testNvrConnection({
    nvr,
    credentialId: body.credentialId,
    actor: guard.actor,
  });

  // Un test en échec reste une réponse valide de l'API : c'est le champ `ok`
  // qui porte le résultat, l'interface affiche le motif.
  return NextResponse.json(result);
}

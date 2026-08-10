import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { loadNvr, testAllCredentials, testNvrConnection } from "@/lib/dahua/service";

/**
 * POST /api/v1/nvrs/[id]/test — Teste l'accès à un enregistreur.
 *
 * Corps : { "credentialId"?: string, "all"?: boolean, "includeRights"?: boolean }
 *
 * Un échec de connexion n'est pas une erreur d'API : la réponse reste en 200 et
 * porte `ok: false` avec le motif, pour qu'un agent puisse raisonner dessus.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "nvr:test");
  if (!guard.ok) return guard.response;

  const nvr = await loadNvr((await params).id);
  if (!nvr) return apiError(404, "not_found", "Enregistreur introuvable");

  const body = (await req.json().catch(() => ({}))) as {
    credentialId?: string;
    all?: boolean;
    includeRights?: boolean;
  };

  if (body.all) {
    const results = await testAllCredentials({ nvr, actor: guard.actor });
    return NextResponse.json({
      nvr: { id: nvr.id, name: nvr.name },
      results,
      summary: {
        tested: results.length,
        working: results.filter((result) => result.ok).length,
        failing: results.filter((result) => !result.ok).length,
      },
    });
  }

  const result = await testNvrConnection({
    nvr,
    credentialId: body.credentialId,
    includeRights: body.includeRights !== false,
    actor: guard.actor,
  });

  return NextResponse.json({ nvr: { id: nvr.id, name: nvr.name }, ...result });
}

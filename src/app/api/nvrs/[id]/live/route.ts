import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { loadNvr, pickCredential, statusForReason } from "@/lib/dahua/service";
import { DahuaError } from "@/lib/dahua/http";
import { LIVE_BOUNDARY, openLiveStream } from "@/lib/dahua/live";

/**
 * GET /api/nvrs/[id]/live?channel=N — Direct d'UNE caméra, flux secondaire,
 * en MJPEG (à afficher dans une balise <img>). Un seul direct par utilisateur ;
 * la connexion est coupée dès que la page est quittée.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const channel = Number(new URL(req.url).searchParams.get("channel") ?? 1);
  if (!Number.isInteger(channel) || channel < 1 || channel > 256) {
    return NextResponse.json({ error: "Voie invalide" }, { status: 400 });
  }

  const { id } = await params;
  const nvr = await loadNvr(id);
  if (!nvr) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });
  const credential = pickCredential(nvr);
  if (!credential) {
    return NextResponse.json({ error: "Aucun compte enregistré pour cet enregistreur" }, { status: 400 });
  }

  try {
    const stream = await openLiveStream({
      nvr,
      credential,
      channel,
      viewerId: guard.actor.id ?? guard.actor.label,
      signal: req.signal,
    });
    await recordAudit({
      actor: guard.actor,
      action: "nvr.live_view",
      targetType: "nvr",
      targetId: id,
      metadata: { channel, subtype: 1 },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": `multipart/x-mixed-replace; boundary=${LIVE_BOUNDARY}`,
        "Cache-Control": "no-store, no-transform",
        // Pas de mise en tampon par le reverse proxy (Nginx Proxy Manager).
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Direct indisponible";
    const status = error instanceof DahuaError ? statusForReason(error.reason) : 500;
    return NextResponse.json({ error: message }, { status: status === 200 ? 502 : status });
  }
}

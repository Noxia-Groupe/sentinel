import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { loadNvr, pickCredential } from "@/lib/dahua/service";
import { diagnoseP2p } from "@/lib/dahua/p2p";
import { trafficScope, originForActor } from "@/lib/traffic";

/**
 * POST /api/nvrs/[id]/p2p-diagnostic — Diagnostic de l'accès P2P : pour chaque
 * cloud Dahua (SmartPSS, DMSS), présence de l'équipement puis tentative réelle
 * de tunnel, avec le journal de l'utilitaire.
 *
 * Peut durer deux minutes : la réponse est diffusée ligne par ligne (NDJSON,
 * `{"progress": …}` puis `{"result": …}` ou `{"error": …}`), avec un battement
 * régulier pour qu'un reverse proxy ne coupe pas la requête.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const nvr = await loadNvr(id);
  if (!nvr) return NextResponse.json({ error: "Enregistreur introuvable" }, { status: 404 });
  const serial = nvr.p2pSerial ?? nvr.serialNumber;
  if (nvr.connectionMode !== "p2p" || !serial) {
    return NextResponse.json({ error: "Cet enregistreur n'est pas déclaré en P2P" }, { status: 400 });
  }
  const credential = pickCredential(nvr);
  if (!credential) {
    return NextResponse.json({ error: "Aucun compte enregistré pour cet enregistreur" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          // client parti
        }
      };
      const heartbeat = setInterval(() => send({ heartbeat: Date.now() }), 5_000);
      try {
        const report = await trafficScope(nvr.id, originForActor(guard.actor), () =>
          diagnoseP2p(
            {
              serial,
              devicePort: nvr.httpPort,
              username: credential.username,
              password: decrypt(credential.encryptedPassword),
            },
            (message) => send({ progress: message }),
          ),
        );
        await recordAudit({
          actor: guard.actor,
          action: "nvr.p2p_diagnostic",
          targetType: "nvr",
          targetId: id,
          success: report.workingProfile !== null,
          metadata: {
            workingProfile: report.workingProfile,
            profiles: report.profiles.map((p) => ({
              profile: p.profile,
              cloudKnown: p.cloud.known,
              devP2PVersion: p.cloud.devP2PVersion,
              tunnelOk: p.tunnel?.ok ?? null,
            })),
          },
        });
        send({ result: { ...report, nvr: { id: nvr.id, name: nvr.name, model: nvr.model } } });
      } catch (error) {
        send({ error: error instanceof Error ? error.message : "Diagnostic impossible" });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEvent } from "@/lib/dahua/events";
import { emitAlarmCreated, emitNvrStatus } from "@/lib/outbound-webhooks";
import { recordTraffic } from "@/lib/traffic";

/**
 * Réception des événements Alarm Center.
 *
 * Cette route est publique par conception : le token d'URL, propre à chaque
 * enregistreur, fait office d'authentification. Les firmwares Dahua poussent
 * indifféremment en GET (query string) ou en POST (JSON, formulaire, texte) :
 * les deux verbes sont acceptés et la charge utile est fusionnée avec les
 * paramètres d'URL avant normalisation.
 */

// Fenêtre pendant laquelle une alarme identique non traitée est regroupée
// plutôt que dupliquée — sans cela, une détection de mouvement noie le flux.
const DEDUPE_WINDOW_MS = Number(process.env.DAHUA_DEDUPE_WINDOW_SECONDS ?? 60) * 1000;

// Événements de pure supervision : ils prouvent que le lien est vivant mais
// n'ont pas à apparaître dans le centre d'alarme.
const HEARTBEAT_TYPES = new Set(["heartbeat", "keepalive"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  return handle(req, ctx);
}

/**
 * Trafic d'une alarme reçue, imputé à l'enregistreur (origine « alarmes ») :
 * ligne de requête, en-têtes et corps reçus, plus la réponse renvoyée.
 * Estimation au niveau HTTP : le chiffrement TLS s'y ajoute.
 */
function countAlarmTraffic(req: NextRequest, nvrId: string, bodyBytes: number, response: NextResponse) {
  let headerBytes = 0;
  req.headers.forEach((value, key) => {
    headerBytes += key.length + value.length + 4;
  });
  const url = new URL(req.url);
  const received = req.method.length + url.pathname.length + url.search.length + 12 + headerBytes + bodyBytes;
  // Réponse : ligne de statut et en-têtes usuels (~150 o) + corps JSON.
  const sent = 150 + Number(response.headers.get("content-length") ?? 60);
  recordTraffic(received, sent, { nvrId, origin: "alarmes" });
  return response;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const outcome = await receive(req, ctx);
  if (outcome.nvrId) countAlarmTraffic(req, outcome.nvrId, outcome.bodyBytes, outcome.response);
  return outcome.response;
}

async function receive(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<{ response: NextResponse; nvrId?: string; bodyBytes: number }> {
  const { token } = await params;

  const nvr = await prisma.nvr.findUnique({
    where: { webhookToken: token },
    select: { id: true, status: true },
  });

  if (!nvr) {
    return { response: NextResponse.json({ error: "NVR non trouvé" }, { status: 404 }), bodyBytes: 0 };
  }

  const { payload, bodyBytes } = await readPayload(req);
  const reply = (response: NextResponse) => ({ response, nvrId: nvr.id, bodyBytes });
  const normalized = normalizeEvent(payload);

  // Toute réception vaut preuve de vie, y compris un simple battement de cœur.
  await prisma.nvr.update({
    where: { id: nvr.id },
    data: { status: "online", lastSeen: new Date() },
  });
  if (nvr.status === "offline") {
    void emitNvrStatus(nvr.id, "online");
  }

  if (HEARTBEAT_TYPES.has(normalized.type.toLowerCase())) {
    return reply(NextResponse.json({ success: true, stored: false, reason: "heartbeat" }));
  }

  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent =
    DEDUPE_WINDOW_MS > 0
      ? await prisma.nvrEvent.findFirst({
          where: {
            nvrId: nvr.id,
            type: normalized.type,
            channel: normalized.channel ?? null,
            status: "new",
            receivedAt: { gte: since },
          },
          orderBy: { receivedAt: "desc" },
          select: { id: true },
        })
      : null;

  if (recent) {
    await prisma.nvrEvent.update({
      where: { id: recent.id },
      data: { receivedAt: new Date(), payload: payload as object },
    });
    return reply(NextResponse.json({ success: true, stored: false, reason: "deduplicated", eventId: recent.id }));
  }

  const event = await prisma.nvrEvent.create({
    data: {
      nvrId: nvr.id,
      type: normalized.type,
      code: normalized.code ?? null,
      title: normalized.title,
      severity: normalized.severity,
      channel: normalized.channel ?? null,
      payload: payload as object,
      source: "webhook",
    },
    select: { id: true, severity: true, title: true },
  });

  // Relais vers les webhooks sortants (agent Hermes…), sans retarder la réponse.
  void emitAlarmCreated(event.id);

  return reply(NextResponse.json({ success: true, stored: true, event }));
}

/** Lit le corps et le fusionne avec les paramètres d'URL en un seul objet. */
async function readPayload(req: NextRequest): Promise<{ payload: Record<string, unknown>; bodyBytes: number }> {
  const raw = req.method === "GET" ? "" : await req.text();
  return { payload: parsePayload(req, raw), bodyBytes: Buffer.byteLength(raw) };
}

function parsePayload(req: NextRequest, raw: string): Record<string, unknown> {
  const query = Object.fromEntries(new URL(req.url).searchParams.entries());

  if (req.method === "GET") return query;

  const contentType = req.headers.get("content-type") ?? "";

  if (!raw) return query;

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? { ...query, ...(parsed as Record<string, unknown>) }
        : { ...query, body: parsed };
    } catch {
      return { ...query, raw };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return { ...query, ...Object.fromEntries(new URLSearchParams(raw).entries()) };
  }

  // Certains firmwares poussent du JSON sans en déclarer le type.
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        return { ...query, ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // On retombe sur le texte brut.
    }
  }

  return { ...query, raw };
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEvent } from "@/lib/dahua/events";
import { emitAlarmCreated, emitNvrStatus } from "@/lib/outbound-webhooks";
import { recordTraffic } from "@/lib/traffic";
import { requestIp } from "@/lib/actor";
import {
  envInt,
  webhookTokenLimiter,
  webhookUnknownLimiter,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { isWellFormedWebhookToken } from "@/lib/webhook-token";

/**
 * Réception des événements Alarm Center.
 *
 * Cette route est publique par conception : le token d'URL, propre à chaque
 * enregistreur, fait office d'authentification. Les firmwares Dahua poussent
 * indifféremment en GET (query string) ou en POST (JSON, formulaire, texte) :
 * les deux verbes sont acceptés et la charge utile est fusionnée avec les
 * paramètres d'URL avant normalisation.
 *
 * Garde-fous, l'endpoint étant exposé sans session :
 * - jeton mal formé ou inconnu : 404, et au plus N tentatives par minute et
 *   par adresse IP (`WEBHOOK_UNKNOWN_TOKEN_RATE_LIMIT`) — la recherche du
 *   jeton par force brute devient impraticable ;
 * - jeton valide : au plus N appels par minute et par enregistreur
 *   (`WEBHOOK_RATE_LIMIT`), battements de cœur compris ;
 * - corps limité à `WEBHOOK_MAX_BODY_BYTES` (64 Ko par défaut) : 413 au-delà,
 *   sans lecture complète ni écriture en base.
 */

// Fenêtre pendant laquelle une alarme identique non traitée est regroupée
// plutôt que dupliquée — sans cela, une détection de mouvement noie le flux.
const DEDUPE_WINDOW_MS = Number(process.env.DAHUA_DEDUPE_WINDOW_SECONDS ?? 60) * 1000;

/** Taille maximale du corps d'une notification. */
const MAX_BODY_BYTES = envInt("WEBHOOK_MAX_BODY_BYTES", 64 * 1024);

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

function tooManyRequests(rate: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Trop de requêtes", retryAfter: rate.retryAfter },
    { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
  );
}

async function receive(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<{ response: NextResponse; nvrId?: string; bodyBytes: number }> {
  const { token } = await params;

  const nvr = isWellFormedWebhookToken(token)
    ? await prisma.nvr.findUnique({
        where: { webhookToken: token },
        select: { id: true, status: true },
      })
    : null;

  if (!nvr) {
    // Jeton mal formé ou inconnu : même réponse dans les deux cas, et
    // limitation par adresse pour rendre la force brute impraticable.
    const rate = webhookUnknownLimiter.check(requestIp(req) ?? "inconnue");
    if (!rate.allowed) return { response: tooManyRequests(rate), bodyBytes: 0 };
    return { response: NextResponse.json({ error: "NVR non trouvé" }, { status: 404 }), bodyBytes: 0 };
  }

  const rate = webhookTokenLimiter.check(nvr.id);
  if (!rate.allowed) {
    return { response: tooManyRequests(rate), nvrId: nvr.id, bodyBytes: declaredLength(req) };
  }

  const read = await readPayload(req);
  if (!read.ok) {
    return {
      response: NextResponse.json(
        { error: `Corps trop volumineux (maximum ${MAX_BODY_BYTES} octets)` },
        { status: 413 },
      ),
      nvrId: nvr.id,
      bodyBytes: read.bodyBytes,
    };
  }
  const { payload, bodyBytes } = read;
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

/** Taille annoncée par `Content-Length`, 0 si absente ou invalide. */
function declaredLength(req: NextRequest): number {
  const value = Number(req.headers.get("content-length"));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

type ReadOutcome =
  | { ok: true; payload: Record<string, unknown>; bodyBytes: number }
  | { ok: false; bodyBytes: number };

/** Lit le corps (borné) et le fusionne avec les paramètres d'URL en un seul objet. */
async function readPayload(req: NextRequest): Promise<ReadOutcome> {
  if (req.method === "GET") return { ok: true, payload: parsePayload(req, ""), bodyBytes: 0 };

  const declared = declaredLength(req);
  if (declared > MAX_BODY_BYTES) return { ok: false, bodyBytes: declared };

  const raw = await readBounded(req, MAX_BODY_BYTES);
  if (raw === null) return { ok: false, bodyBytes: MAX_BODY_BYTES };

  return { ok: true, payload: parsePayload(req, raw), bodyBytes: Buffer.byteLength(raw) };
}

/**
 * Lit le corps en s'arrêtant dès que la limite est dépassée (`null` dans ce
 * cas) : un envoi en `chunked` sans `Content-Length` ne peut pas contourner
 * la limite, et rien n'est accumulé au-delà.
 */
async function readBounded(req: NextRequest, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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

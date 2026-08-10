import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEvent } from "@/lib/dahua/events";

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

async function handle(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const nvr = await prisma.nvr.findUnique({
    where: { webhookToken: token },
    select: { id: true, status: true },
  });

  if (!nvr) {
    return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });
  }

  const payload = await readPayload(req);
  const normalized = normalizeEvent(payload);

  // Toute réception vaut preuve de vie, y compris un simple battement de cœur.
  await prisma.nvr.update({
    where: { id: nvr.id },
    data: { status: "online", lastSeen: new Date() },
  });

  if (HEARTBEAT_TYPES.has(normalized.type.toLowerCase())) {
    return NextResponse.json({ success: true, stored: false, reason: "heartbeat" });
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
    return NextResponse.json({ success: true, stored: false, reason: "deduplicated", eventId: recent.id });
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

  return NextResponse.json({ success: true, stored: true, event });
}

/** Fusionne les paramètres d'URL et le corps de la requête en un seul objet. */
async function readPayload(req: NextRequest): Promise<Record<string, unknown>> {
  const query = Object.fromEntries(new URL(req.url).searchParams.entries());

  if (req.method === "GET") return query;

  const contentType = req.headers.get("content-type") ?? "";
  const raw = await req.text();

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

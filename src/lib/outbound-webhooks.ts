import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { decrypt, encrypt } from "./crypto";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  eventCategory,
  type EventSeverity,
} from "./dahua/events";

/**
 * Webhooks sortants : Sentinel pousse les alarmes et pannes choisies vers un
 * récepteur externe — typiquement un agent Hermes, dont le format « generic »
 * est suivi à la lettre :
 *
 * - corps JSON portant `event_type` (Hermes filtre ses routes dessus) ;
 * - `X-Webhook-Timestamp` + `X-Webhook-Signature-V2` = HMAC-SHA256 hexadécimal
 *   de `<timestamp>.<corps>` (anti-rejeu ±300 s côté Hermes) ;
 * - `X-Webhook-Signature` = HMAC-SHA256 hexadécimal du corps seul (V1, pour
 *   les récepteurs plus anciens) ;
 * - `X-Request-ID` = identifiant de livraison, stable entre les tentatives :
 *   Hermes s'en sert pour écarter les doublons.
 *
 * Chaque livraison est enregistrée, retentée avec un délai croissant en cas
 * d'échec transitoire, et consultable dans les paramètres.
 */

export const OUTBOUND_EVENT_TYPES = [
  "alarm.created",
  "alarm.status_changed",
  "nvr.offline",
  "nvr.online",
  "sentinel.test",
] as const;
export type OutboundEventType = (typeof OUTBOUND_EVENT_TYPES)[number];

const SEVERITY_TAG: Record<EventSeverity, string> = {
  critical: "CRITIQUE",
  major: "MAJEURE",
  minor: "MINEURE",
  info: "INFO",
};

/** Délais avant chaque nouvelle tentative (après la 1re, la 2e…). */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
/** Bail posé sur une livraison en cours d'envoi, pour qu'un seul envoi parte. */
const DELIVERY_LEASE_MS = 60_000;

// ---------------------------------------------------------------------------
// Secret, URL, signature
// ---------------------------------------------------------------------------

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("hex")}`;
}

export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

export function signBody(secret: string, body: string, timestamp: number) {
  const hmac = (data: string) => crypto.createHmac("sha256", secret).update(data).digest("hex");
  return { v1: hmac(body), v2: hmac(`${timestamp}.${body}`) };
}

/** Adresses jamais joignables par un webhook : lien local (métadonnées cloud). */
function isForbiddenAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    return address.startsWith("169.254.") || address === "0.0.0.0";
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return (
      lower === "::" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("::ffff:169.254.") ||
      lower.startsWith("fd00:ec2::")
    );
  }
  return false;
}

/**
 * Contrôle d'une URL de webhook à l'enregistrement. Les adresses privées sont
 * permises (Hermes tourne souvent sur le même réseau ou un VPN), mais pas les
 * adresses de lien local — celles des services de métadonnées cloud.
 */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "URL invalide" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Seules les URL http(s) sont acceptées" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "L'URL ne doit pas contenir d'identifiants" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isForbiddenAddress(host) || host === "metadata.google.internal") {
    return { ok: false, error: "Adresse de destination non autorisée" };
  }
  return { ok: true, url: url.toString() };
}

/** Revérifie la résolution DNS au moment de l'envoi (anti DNS rebinding). */
async function assertDeliverableHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.some(isForbiddenAddress)) {
    throw new Error("La destination résout vers une adresse non autorisée");
  }
}

// ---------------------------------------------------------------------------
// Construction des événements
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.AUTH_URL || "").replace(/\/+$/, "");
}

type NvrSummary = {
  id: string;
  name: string;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  status: string;
  connectionMode: string;
  client: { id: string; name: string; code: string | null } | null;
};

const NVR_SELECT = {
  id: true,
  name: true,
  model: true,
  serialNumber: true,
  location: true,
  status: true,
  connectionMode: true,
  client: { select: { id: true, name: true, code: true } },
} satisfies Prisma.NvrSelect;

function nvrBlock(nvr: NvrSummary) {
  return {
    id: nvr.id,
    name: nvr.name,
    model: nvr.model,
    serial_number: nvr.serialNumber,
    location: nvr.location,
    status: nvr.status,
    connection_mode: nvr.connectionMode,
    url: `${baseUrl()}/nvrs/${nvr.id}`,
  };
}

function clientBlock(nvr: NvrSummary) {
  return nvr.client ? { id: nvr.client.id, name: nvr.client.name, code: nvr.client.code } : null;
}

function where(nvr: NvrSummary): string {
  return nvr.client ? `${nvr.name} (${nvr.client.name})` : nvr.name;
}

/** Ce qu'il faut savoir d'une alarme pour la router et la décrire. */
type AlarmFacts = {
  id: string;
  type: string;
  code: string | null;
  title: string | null;
  severity: string;
  status: string;
  channel: number | null;
  receivedAt: Date;
  nvr: NvrSummary;
};

function alarmBlock(alarm: AlarmFacts) {
  const severity = alarm.severity as EventSeverity;
  const category = eventCategory(alarm.type);
  return {
    id: alarm.id,
    type: alarm.type,
    code: alarm.code,
    title: alarm.title ?? alarm.type,
    severity,
    severity_label: SEVERITY_LABELS[severity] ?? alarm.severity,
    category,
    category_label: CATEGORY_LABELS[category],
    status: alarm.status,
    channel: alarm.channel,
    received_at: alarm.receivedAt.toISOString(),
    url: `${baseUrl()}/alarms`,
  };
}

function alarmSummary(alarm: AlarmFacts): string {
  const tag = SEVERITY_TAG[alarm.severity as EventSeverity] ?? alarm.severity.toUpperCase();
  const channel = alarm.channel !== null ? `, canal ${alarm.channel}` : "";
  return `[${tag}] ${alarm.title ?? alarm.type} — ${where(alarm.nvr)}${channel}`;
}

type Routing = {
  eventType: OutboundEventType;
  severity?: string;
  category?: string;
  clientId?: string | null;
  payload: Record<string, unknown>;
};

type EndpointFilter = {
  severities: string[];
  categories: string[];
  clientIds: string[];
  notifyStatusChanges: boolean;
  notifyNvrStatus: boolean;
};

/** Un webhook reçoit-il cet événement ? Liste vide = pas de restriction. */
export function matchesEndpoint(endpoint: EndpointFilter, routing: Omit<Routing, "payload">): boolean {
  if (routing.eventType === "alarm.status_changed" && !endpoint.notifyStatusChanges) return false;
  if ((routing.eventType === "nvr.offline" || routing.eventType === "nvr.online") && !endpoint.notifyNvrStatus) {
    return false;
  }
  if (endpoint.clientIds.length && !(routing.clientId && endpoint.clientIds.includes(routing.clientId))) {
    return false;
  }
  const isAlarm = routing.eventType === "alarm.created" || routing.eventType === "alarm.status_changed";
  if (isAlarm) {
    if (endpoint.severities.length && !endpoint.severities.includes(routing.severity ?? "")) return false;
    if (endpoint.categories.length && !endpoint.categories.includes(routing.category ?? "")) return false;
  }
  return true;
}

async function dispatch(routing: Routing): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { enabled: true } });
  const targets = endpoints.filter((endpoint) => matchesEndpoint(endpoint, routing));
  for (const endpoint of targets) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventType: routing.eventType,
        payload: routing.payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // Premier envoi immédiat, sans bloquer l'appelant ; les échecs sont repris
    // par le worker (src/instrumentation.ts).
    void deliver(delivery.id);
  }
}

/** N'échoue jamais : un webhook sortant ne doit pas faire échouer la réception d'une alarme. */
async function safely(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[webhooks] ${label}`, error);
  }
}

/** Nouvelle alarme enregistrée (après regroupement des doublons). */
export function emitAlarmCreated(eventId: string): Promise<void> {
  return safely("alarm.created", async () => {
    const alarm = await prisma.nvrEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        code: true,
        title: true,
        severity: true,
        status: true,
        channel: true,
        receivedAt: true,
        nvr: { select: NVR_SELECT },
      },
    });
    if (!alarm) return;
    await dispatch({
      eventType: "alarm.created",
      severity: alarm.severity,
      category: eventCategory(alarm.type),
      clientId: alarm.nvr.client?.id ?? null,
      payload: {
        event_type: "alarm.created",
        occurred_at: alarm.receivedAt.toISOString(),
        summary: alarmSummary(alarm),
        alarm: alarmBlock(alarm),
        nvr: nvrBlock(alarm.nvr),
        client: clientBlock(alarm.nvr),
      },
    });
  });
}

/** Changement de statut d'une alarme (prise en compte, clôture…). */
export function emitAlarmStatusChanged(eventId: string, previousStatus: string, changedBy: string): Promise<void> {
  return safely("alarm.status_changed", async () => {
    const alarm = await prisma.nvrEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        code: true,
        title: true,
        severity: true,
        status: true,
        channel: true,
        receivedAt: true,
        nvr: { select: NVR_SELECT },
      },
    });
    if (!alarm || alarm.status === previousStatus) return;
    await dispatch({
      eventType: "alarm.status_changed",
      severity: alarm.severity,
      category: eventCategory(alarm.type),
      clientId: alarm.nvr.client?.id ?? null,
      payload: {
        event_type: "alarm.status_changed",
        occurred_at: new Date().toISOString(),
        summary: `${alarmSummary(alarm)} : ${previousStatus} → ${alarm.status} (par ${changedBy})`,
        previous_status: previousStatus,
        changed_by: changedBy,
        alarm: alarmBlock(alarm),
        nvr: nvrBlock(alarm.nvr),
        client: clientBlock(alarm.nvr),
      },
    });
  });
}

/** Un enregistreur passe hors ligne ou revient en ligne. */
export function emitNvrStatus(
  nvrId: string,
  status: "offline" | "online",
  reason?: string,
): Promise<void> {
  return safely(`nvr.${status}`, async () => {
    const nvr = await prisma.nvr.findUnique({ where: { id: nvrId }, select: NVR_SELECT });
    if (!nvr) return;
    const eventType = status === "offline" ? "nvr.offline" : "nvr.online";
    await dispatch({
      eventType,
      clientId: nvr.client?.id ?? null,
      payload: {
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        summary:
          status === "offline"
            ? `[PANNE] Enregistreur injoignable — ${where(nvr)}${reason ? ` : ${reason}` : ""}`
            : `[RÉTABLI] Enregistreur de nouveau joignable — ${where(nvr)}`,
        reason: reason ?? null,
        nvr: nvrBlock(nvr),
        client: clientBlock(nvr),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Livraison
// ---------------------------------------------------------------------------

export type DeliveryResult = { ok: boolean; status?: number; error?: string };

/**
 * Envoie une livraison. Le bail (`nextAttemptAt` repoussé) garantit qu'un seul
 * processus l'envoie, même si l'envoi immédiat et le worker se croisent.
 */
export async function deliver(deliveryId: string): Promise<DeliveryResult> {
  const now = new Date();
  const claim = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: "pending", nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS) },
  });
  if (claim.count !== 1) return { ok: false, error: "déjà en cours ou terminée" };

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return { ok: false, error: "introuvable" };

  const attempts = delivery.attempts + 1;
  let result: DeliveryResult;
  let retryable = true;

  if (!delivery.endpoint.enabled) {
    result = { ok: false, error: "Webhook désactivé" };
    retryable = false;
  } else {
    try {
      const url = new URL(delivery.endpoint.url);
      await assertDeliverableHost(url);
      const secret = decrypt(delivery.endpoint.secretEncrypted);
      const body = JSON.stringify({
        ...(delivery.payload as Record<string, unknown>),
        delivery_id: delivery.id,
        sentinel: { base_url: baseUrl(), mcp_url: `${baseUrl()}/api/mcp` },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signBody(secret, body, timestamp);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Sentinel-Webhooks/1.0",
          "X-Request-ID": delivery.id,
          "X-Sentinel-Event": delivery.eventType,
          "X-Webhook-Timestamp": String(timestamp),
          "X-Webhook-Signature-V2": signature.v2,
          "X-Webhook-Signature": signature.v1,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // On ne lit que le début de la réponse, pour le diagnostic.
      const text = (await res.text().catch(() => "")).slice(0, 300);
      if (res.ok) {
        result = { ok: true, status: res.status };
      } else {
        result = { ok: false, status: res.status, error: text || res.statusText };
        // 4xx = requête refusée (signature, route inconnue…) : réessayer n'y
        // changera rien, sauf délai dépassé ou limitation de débit.
        retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      }
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const exhausted = attempts >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      lastStatus: result.status ?? null,
      lastError: result.ok ? null : (result.error ?? "échec").slice(0, 500),
      ...(result.ok
        ? { status: "success", deliveredAt: new Date() }
        : !retryable || exhausted
          ? { status: "failed" }
          : { nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]) }),
    },
  });
  return result;
}

/** Événement de test, envoyé et attendu depuis les paramètres. */
export async function sendTestDelivery(endpointId: string, actorLabel: string): Promise<DeliveryResult> {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      endpointId,
      eventType: "sentinel.test",
      payload: {
        event_type: "sentinel.test",
        occurred_at: new Date().toISOString(),
        summary: `Test de liaison Sentinel → webhook, déclenché par ${actorLabel}`,
      },
    },
    select: { id: true },
  });
  return deliver(delivery.id);
}

/** Reprend les livraisons échues. Appelé périodiquement par le worker. */
export async function processDueDeliveries(limit = 20): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) await deliver(id);
  return due.length;
}

/** Purge l'historique : livraisons terminées de plus de 30 jours. */
export async function pruneDeliveries(): Promise<void> {
  await prisma.webhookDelivery.deleteMany({
    where: {
      status: { in: ["success", "failed"] },
      createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600_000) },
    },
  });
}

let workerStarted = false;

/** Worker de reprise, démarré une fois par processus serveur. */
export function startWebhookWorker(intervalMs = 15_000): void {
  if (workerStarted) return;
  workerStarted = true;
  let running = false;
  let ticks = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    ticks += 1;
    processDueDeliveries()
      .then(() => (ticks % 240 === 0 ? pruneDeliveries() : undefined))
      .catch((error) => console.error("[webhooks] worker", error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
}

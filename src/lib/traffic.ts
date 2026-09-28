import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "./actor";
import { prisma } from "./prisma";

/**
 * Mesure du trafic réseau échangé entre Sentinel et chaque enregistreur.
 *
 * Chaque échange est compté au plus près du réseau (octets réellement lus et
 * écrits sur la connexion) et attribué à une origine : supervision
 * automatique, interventions d'un utilisateur, agent (Hermes), direct vidéo,
 * alarmes reçues. De quoi afficher le débit en cours et mesurer ce que coûte
 * la supervision à distance.
 *
 * - En mémoire : fenêtres de 5 s sur les 5 dernières minutes, pour le débit
 *   instantané (rien n'est écrit en base à chaque requête).
 * - En base : cumuls horaires par enregistreur et par origine (`NvrTraffic`),
 *   écrits par lots chaque minute.
 *
 * Limite : c'est le trafic applicatif (HTTP, RTSP). En P2P, l'encapsulation
 * du tunnel et ses messages de maintien de connexion s'y ajoutent.
 */

export const TRAFFIC_ORIGINS = ["supervision", "interventions", "agent", "direct", "alarmes"] as const;
export type TrafficOrigin = (typeof TRAFFIC_ORIGINS)[number];

export const ORIGIN_LABELS: Record<TrafficOrigin, string> = {
  supervision: "Supervision automatique",
  interventions: "Interventions et tests",
  agent: "Agent (API / Hermes)",
  direct: "Direct vidéo",
  alarmes: "Alarmes reçues",
};

/** Contexte d'un échange en cours : à qui imputer les octets. */
export type TrafficScope = {
  nvrId: string;
  origin: TrafficOrigin;
  /** Cumul propre à ce contexte (ex. coût d'une vérification). */
  bytesIn: number;
  bytesOut: number;
  requests: number;
};

const storage = new AsyncLocalStorage<TrafficScope>();

/** Origine correspondant à l'auteur d'une action. */
export function originForActor(actor: Pick<Actor, "type">): TrafficOrigin {
  if (actor.type === "apikey") return "agent";
  if (actor.type === "system") return "supervision";
  return "interventions";
}

/**
 * Exécute `run` en imputant tout le trafic vers l'enregistreur à `nvrId` /
 * `origin`. Renvoie aussi le trafic consommé par ce seul appel.
 */
export async function withTraffic<T>(
  nvrId: string,
  origin: TrafficOrigin,
  run: () => Promise<T>,
): Promise<{ result: T; usage: TrafficScope }> {
  const scope: TrafficScope = { nvrId, origin, bytesIn: 0, bytesOut: 0, requests: 0 };
  const result = await storage.run(scope, run);
  return { result, usage: scope };
}

/** Variante sans relevé : impute seulement. */
export function trafficScope<T>(nvrId: string, origin: TrafficOrigin, run: () => Promise<T>): Promise<T> {
  return withTraffic(nvrId, origin, run).then(({ result }) => result);
}

export function currentTrafficScope(): TrafficScope | undefined {
  return storage.getStore();
}

// ---------------------------------------------------------------------------
// Compteurs
// ---------------------------------------------------------------------------

const WINDOW_MS = 5_000;
const WINDOWS_KEPT = 60; // 5 minutes
/** Débit « en cours » : moyenne sur les 15 dernières secondes. */
const CURRENT_SPAN_MS = 15_000;

type Window = { start: number; bytesIn: number; bytesOut: number };
type Pending = { bytesIn: number; bytesOut: number; requests: number };

type Meter = {
  windows: Window[];
  lastActivity: number;
  /** Cumuls à écrire en base, par origine, pour l'heure en cours. */
  pending: Map<TrafficOrigin, Pending>;
};

const globalForTraffic = globalThis as unknown as {
  sentinelTraffic?: { meters: Map<string, Meter>; flushStarted: boolean };
};
const state = (globalForTraffic.sentinelTraffic ??= { meters: new Map(), flushStarted: false });

function meterFor(nvrId: string): Meter {
  let meter = state.meters.get(nvrId);
  if (!meter) {
    meter = { windows: [], lastActivity: 0, pending: new Map() };
    state.meters.set(nvrId, meter);
  }
  return meter;
}

/** Ajoute des octets à un enregistreur (contexte explicite ou courant). */
export function recordTraffic(
  bytesIn: number,
  bytesOut: number,
  target: { nvrId: string; origin: TrafficOrigin } | undefined = currentTrafficScope(),
  requests = 1,
): void {
  if (!target || (bytesIn <= 0 && bytesOut <= 0 && requests <= 0)) return;
  const scope = currentTrafficScope();
  if (scope && scope.nvrId === target.nvrId && scope.origin === target.origin) {
    scope.bytesIn += bytesIn;
    scope.bytesOut += bytesOut;
    scope.requests += requests;
  }

  const now = Date.now();
  const meter = meterFor(target.nvrId);
  const start = now - (now % WINDOW_MS);
  let window = meter.windows[meter.windows.length - 1];
  if (!window || window.start !== start) {
    window = { start, bytesIn: 0, bytesOut: 0 };
    meter.windows.push(window);
    if (meter.windows.length > WINDOWS_KEPT) meter.windows.splice(0, meter.windows.length - WINDOWS_KEPT);
  }
  window.bytesIn += bytesIn;
  window.bytesOut += bytesOut;
  meter.lastActivity = now;

  const pending = meter.pending.get(target.origin) ?? { bytesIn: 0, bytesOut: 0, requests: 0 };
  pending.bytesIn += bytesIn;
  pending.bytesOut += bytesOut;
  pending.requests += requests;
  meter.pending.set(target.origin, pending);
  startFlush();
}

export type LiveRate = {
  /** Octets par seconde reçus de l'enregistreur (descendant). */
  inBps: number;
  /** Octets par seconde envoyés à l'enregistreur (montant). */
  outBps: number;
  /** Pointe sur 5 min, en octets par seconde (fenêtres de 5 s). */
  peakBps: number;
  /** Volume échangé sur les 5 dernières minutes. */
  last5min: { bytesIn: number; bytesOut: number };
  lastActivity: string | null;
  active: boolean;
};

export function liveRate(nvrId: string, now = Date.now()): LiveRate {
  const meter = state.meters.get(nvrId);
  const windows: Window[] = (meter?.windows ?? []).filter((w: Window) => now - w.start < WINDOWS_KEPT * WINDOW_MS);
  const recent = windows.filter((w) => now - w.start < CURRENT_SPAN_MS);
  const seconds = CURRENT_SPAN_MS / 1000;
  const inBps = recent.reduce((sum, w) => sum + w.bytesIn, 0) / seconds;
  const outBps = recent.reduce((sum, w) => sum + w.bytesOut, 0) / seconds;
  return {
    inBps: Math.round(inBps),
    outBps: Math.round(outBps),
    peakBps: Math.round(Math.max(0, ...windows.map((w) => (w.bytesIn + w.bytesOut) / (WINDOW_MS / 1000)))),
    last5min: {
      bytesIn: windows.reduce((sum, w) => sum + w.bytesIn, 0),
      bytesOut: windows.reduce((sum, w) => sum + w.bytesOut, 0),
    },
    lastActivity: meter?.lastActivity ? new Date(meter.lastActivity).toISOString() : null,
    active: inBps + outBps > 0,
  };
}

// ---------------------------------------------------------------------------
// Persistance (cumuls horaires)
// ---------------------------------------------------------------------------

const FLUSH_MS = 60_000;

function hourStart(date = new Date()): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Écrit les cumuls en attente ; appelé chaque minute et à la demande. */
export async function flushTraffic(): Promise<void> {
  const bucket = hourStart();
  const writes: Promise<unknown>[] = [];
  for (const [nvrId, meter] of state.meters) {
    for (const [origin, pending] of meter.pending) {
      meter.pending.delete(origin);
      writes.push(
        prisma.nvrTraffic
          .upsert({
            where: { nvrId_bucket_origin: { nvrId, bucket, origin } },
            create: {
              nvrId,
              bucket,
              origin,
              bytesIn: BigInt(pending.bytesIn),
              bytesOut: BigInt(pending.bytesOut),
              requests: pending.requests,
            },
            update: {
              bytesIn: { increment: BigInt(pending.bytesIn) },
              bytesOut: { increment: BigInt(pending.bytesOut) },
              requests: { increment: pending.requests },
            },
          })
          .catch((error: unknown) => {
            // Enregistreur supprimé entre-temps : cumul abandonné.
            if ((error as { code?: string }).code !== "P2003") console.error("[traffic] écriture", error);
          }),
      );
    }
  }
  await Promise.all(writes);
}

function startFlush() {
  if (state.flushStarted) return;
  state.flushStarted = true;
  const timer = setInterval(() => void flushTraffic(), FLUSH_MS);
  timer.unref?.();
}

/** Suppression des cumuls de plus de 90 jours. */
export async function pruneTraffic(): Promise<void> {
  await prisma.nvrTraffic.deleteMany({ where: { bucket: { lt: new Date(Date.now() - 90 * 24 * 3600_000) } } });
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

type Totals = { bytesIn: number; bytesOut: number; requests: number };

function emptyTotals(): Totals {
  return { bytesIn: 0, bytesOut: 0, requests: 0 };
}

/** Débit en cours et volume 24 h de tous les enregistreurs (liste). */
export async function fleetTraffic() {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.nvrTraffic.groupBy({
    by: ["nvrId"],
    where: { bucket: { gte: hourStart(since) } },
    _sum: { bytesIn: true, bytesOut: true },
  });
  const day = new Map(rows.map((row) => [row.nvrId, Number(row._sum.bytesIn ?? 0) + Number(row._sum.bytesOut ?? 0)]));
  const ids = new Set([...day.keys(), ...state.meters.keys()]);
  return Object.fromEntries(
    [...ids].map((nvrId) => {
      const pending = [...(state.meters.get(nvrId)?.pending.values() ?? [])].reduce(
        (sum, p) => sum + p.bytesIn + p.bytesOut,
        0,
      );
      return [nvrId, { ...liveRate(nvrId), last24hBytes: (day.get(nvrId) ?? 0) + pending }];
    }),
  );
}

/** Consommation détaillée d'un enregistreur : par origine, par jour, par heure. */
export async function nvrTraffic(nvrId: string) {
  await flushTraffic();
  const now = Date.now();
  const since7d = hourStart(new Date(now - 7 * 24 * 3600_000));
  const since24h = hourStart(new Date(now - 24 * 3600_000));
  const rows = await prisma.nvrTraffic.findMany({
    where: { nvrId, bucket: { gte: since7d } },
    orderBy: { bucket: "asc" },
  });

  const byOrigin24h = Object.fromEntries(TRAFFIC_ORIGINS.map((o) => [o, emptyTotals()])) as Record<
    TrafficOrigin,
    Totals
  >;
  const byOrigin7d = Object.fromEntries(TRAFFIC_ORIGINS.map((o) => [o, emptyTotals()])) as Record<
    TrafficOrigin,
    Totals
  >;
  const hourly = new Map<string, Totals & { supervision: number }>();
  for (const row of rows) {
    const origin = (TRAFFIC_ORIGINS as readonly string[]).includes(row.origin)
      ? (row.origin as TrafficOrigin)
      : "interventions";
    const values = { bytesIn: Number(row.bytesIn), bytesOut: Number(row.bytesOut), requests: row.requests };
    for (const target of [byOrigin7d[origin], ...(row.bucket >= since24h ? [byOrigin24h[origin]] : [])]) {
      target.bytesIn += values.bytesIn;
      target.bytesOut += values.bytesOut;
      target.requests += values.requests;
    }
    if (row.bucket >= since24h) {
      const key = row.bucket.toISOString();
      const hour = hourly.get(key) ?? { ...emptyTotals(), supervision: 0 };
      hour.bytesIn += values.bytesIn;
      hour.bytesOut += values.bytesOut;
      hour.requests += values.requests;
      if (origin === "supervision") hour.supervision += values.bytesIn + values.bytesOut;
      hourly.set(key, hour);
    }
  }

  const total = (totals: Record<TrafficOrigin, Totals>) =>
    Object.values(totals).reduce((sum, t) => sum + t.bytesIn + t.bytesOut, 0);

  return {
    live: liveRate(nvrId),
    last24h: { totalBytes: total(byOrigin24h), byOrigin: byOrigin24h },
    last7d: { totalBytes: total(byOrigin7d), byOrigin: byOrigin7d },
    hourly: [...hourly.entries()].map(([hour, values]) => ({ hour, ...values })),
  };
}

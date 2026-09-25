import type { Actor } from "./actor";
import { prisma } from "./prisma";
import { updateEvent } from "./alarm-service";
import { emitAlarmCreated, emitNvrStatus } from "./outbound-webhooks";
import { formatDeviceTime, getDeviceInfo, getStorage } from "./dahua/client";
import {
  SUPERVISION_ISSUES,
  supervisionDefinition,
  type SupervisionIssue,
} from "./dahua/events";
import {
  describeError,
  loadNvr,
  pickCredential,
  resolveTarget,
  type NvrWithCredentials,
  type ResolvedTarget,
} from "./dahua/service";

/**
 * Supervision permanente des enregistreurs.
 *
 * À intervalle régulier, Sentinel vérifie chaque enregistreur surveillé comme
 * le ferait un technicien : joignabilité (IP ou tunnel P2P), validité du compte
 * enregistré, état des disques, dérive d'horloge. Chaque vérification est
 * historisée (`HealthCheck`), indépendamment des alarmes poussées par
 * l'équipement — c'est ce qui permet de détecter la panne d'un NVR qui, par
 * définition, ne prévient plus.
 *
 * Une anomalie qui apparaît ouvre une alarme de supervision dans le centre
 * d'alarme (relayée aux webhooks sortants comme toute alarme) ; quand elle
 * disparaît, l'alarme est clôturée automatiquement. L'injoignabilité n'est
 * déclarée qu'après N échecs consécutifs, pour ne pas alerter sur une simple
 * micro-coupure.
 */

export const SUPERVISION_ACTOR: Actor = { type: "system", label: "Supervision Sentinel" };

export type SupervisionSettings = {
  enabled: boolean;
  intervalMinutes: number;
  offlineThreshold: number;
  clockDriftMinutes: number;
};

export const SUPERVISION_LIMITS = {
  intervalMinutes: { min: 1, max: 1440 },
  offlineThreshold: { min: 1, max: 10 },
  clockDriftMinutes: { min: 0, max: 1440 },
};

/** Parallélisme d'une tournée : ménage les tunnels P2P et le cloud Dahua. */
const CYCLE_CONCURRENCY = 3;
/** Conservation de l'historique des vérifications. */
const HISTORY_DAYS = 30;

export async function getSupervisionConfig() {
  return prisma.supervisionConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

function clamp(value: unknown, { min, max }: { min: number; max: number }): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(Math.round(n), min), max);
}

export async function updateSupervisionConfig(patch: Record<string, unknown>) {
  await getSupervisionConfig();
  return prisma.supervisionConfig.update({
    where: { id: "default" },
    data: {
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(clamp(patch.intervalMinutes, SUPERVISION_LIMITS.intervalMinutes) !== undefined
        ? { intervalMinutes: clamp(patch.intervalMinutes, SUPERVISION_LIMITS.intervalMinutes) }
        : {}),
      ...(clamp(patch.offlineThreshold, SUPERVISION_LIMITS.offlineThreshold) !== undefined
        ? { offlineThreshold: clamp(patch.offlineThreshold, SUPERVISION_LIMITS.offlineThreshold) }
        : {}),
      ...(clamp(patch.clockDriftMinutes, SUPERVISION_LIMITS.clockDriftMinutes) !== undefined
        ? { clockDriftMinutes: clamp(patch.clockDriftMinutes, SUPERVISION_LIMITS.clockDriftMinutes) }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Vérification d'un enregistreur
// ---------------------------------------------------------------------------

type ProbeOutcome = {
  /** Vérification impossible (pas de compte, configuration incomplète) : aucune conclusion. */
  skipped?: string;
  reachable: boolean;
  ok: boolean;
  latencyMs?: number;
  message: string;
  /** Anomalies établies par cette vérification (hors injoignabilité, soumise au seuil). */
  detected: SupervisionIssue[];
  /** Anomalies dont l'état n'a pas pu être évalué (conservées telles quelles). */
  unknown: SupervisionIssue[];
  details: Record<string, unknown>;
};

/** `AAAA-MM-JJ HH:MM:SS` → secondes « murales » (comparables entre elles). */
function wallSeconds(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

/** Écart (secondes) entre l'heure de l'enregistreur et l'heure légale attendue. */
export function clockDriftSeconds(deviceTime: string, now = new Date()): number | undefined {
  const device = wallSeconds(deviceTime);
  const expected = wallSeconds(formatDeviceTime(now));
  if (device === undefined || expected === undefined) return undefined;
  return Math.round(device - expected);
}

async function probe(nvr: NvrWithCredentials, clockDriftMinutes: number): Promise<ProbeOutcome> {
  const credential = pickCredential(nvr);
  if (!credential) {
    return {
      skipped: "Aucun compte enregistré : vérification impossible",
      reachable: false,
      ok: false,
      message: "Aucun compte enregistré : vérification impossible",
      detected: [],
      unknown: [...SUPERVISION_ISSUES],
      details: {},
    };
  }

  const startedAt = Date.now();
  let resolved: ResolvedTarget | undefined;
  try {
    resolved = await resolveTarget(nvr, credential);
    const device = await getDeviceInfo(resolved.target);
    const latencyMs = Date.now() - startedAt;
    const detected: SupervisionIssue[] = [];
    const unknown: SupervisionIssue[] = [];
    const details: Record<string, unknown> = {
      model: device.deviceType,
      firmware: device.softwareVersion,
      deviceTime: device.deviceTime,
    };
    const notes: string[] = [];

    // Disques : absent, en erreur ou partition en erreur = panne de stockage.
    try {
      const disks = await getStorage(resolved.target);
      details.storage = disks;
      const faulty = disks.filter((disk) => !disk.healthy);
      if (disks.length === 0) {
        detected.push("SupervisionStorageFault");
        notes.push("aucun disque détecté");
      } else if (faulty.length) {
        detected.push("SupervisionStorageFault");
        notes.push(`disque en erreur : ${faulty.map((d) => `${d.name} (${d.state ?? "?"})`).join(", ")}`);
      }
    } catch (error) {
      // Droit de lecture du stockage absent, firmware sans l'API… : non concluant.
      unknown.push("SupervisionStorageFault");
      details.storageError = describeError(error).message;
    }

    if (clockDriftMinutes > 0) {
      const drift = device.deviceTime ? clockDriftSeconds(device.deviceTime) : undefined;
      if (drift === undefined) {
        unknown.push("SupervisionClockDrift");
      } else {
        details.clockDriftSeconds = drift;
        if (Math.abs(drift) > clockDriftMinutes * 60) {
          detected.push("SupervisionClockDrift");
          notes.push(`horloge décalée de ${Math.round(drift / 60)} min`);
        }
      }
    }

    return {
      reachable: true,
      ok: true,
      latencyMs,
      message: notes.length ? `Joignable — ${notes.join(" ; ")}` : "Joignable, aucune anomalie",
      detected,
      unknown,
      details,
    };
  } catch (error) {
    const failure = describeError(error);
    const latencyMs = Date.now() - startedAt;
    if (failure.reason === "auth" || failure.reason === "forbidden") {
      // L'équipement répond mais refuse le compte : disques et horloge inconnus.
      return {
        reachable: true,
        ok: false,
        latencyMs,
        message: failure.message,
        detected: ["SupervisionAuthFailure"],
        unknown: ["SupervisionStorageFault", "SupervisionClockDrift"],
        details: { reason: failure.reason },
      };
    }
    if (failure.reason === "invalid" || failure.reason === "unsupported") {
      // Configuration incomplète (pas d'IP, P2P désactivé…) : pas une panne.
      return {
        skipped: failure.message,
        reachable: false,
        ok: false,
        message: failure.message,
        detected: [],
        unknown: [...SUPERVISION_ISSUES],
        details: { reason: failure.reason },
      };
    }
    if (failure.reason === "http") {
      // L'équipement répond, mais en erreur : joignable, anomalie non qualifiée.
      return {
        reachable: true,
        ok: false,
        latencyMs,
        message: failure.message,
        detected: [],
        unknown: ["SupervisionAuthFailure", "SupervisionStorageFault", "SupervisionClockDrift"],
        details: { reason: failure.reason },
      };
    }
    return {
      reachable: false,
      ok: false,
      message: failure.message,
      detected: [],
      unknown: ["SupervisionAuthFailure", "SupervisionStorageFault", "SupervisionClockDrift"],
      details: { reason: failure.reason },
    };
  } finally {
    resolved?.release();
  }
}

export type HealthCheckResult = {
  nvrId: string;
  ok: boolean;
  reachable: boolean;
  skipped?: string;
  latencyMs?: number;
  message: string;
  openIssues: SupervisionIssue[];
  opened: SupervisionIssue[];
  closed: SupervisionIssue[];
  consecutiveFailures: number;
};

const OPEN_STATUSES = ["new", "acknowledged", "in_progress"];

/** Vérifie un enregistreur, historise le résultat et fait évoluer ses alarmes. */
export async function checkNvr(nvrId: string, settings?: SupervisionSettings): Promise<HealthCheckResult | null> {
  const nvr = await loadNvr(nvrId);
  if (!nvr) return null;
  const config = settings ?? (await getSupervisionConfig());
  const outcome = await probe(nvr, config.clockDriftMinutes);

  const previous = new Set(nvr.healthIssues as SupervisionIssue[]);
  const next = new Set(previous);
  let failures = nvr.consecutiveFailures;

  if (!outcome.skipped) {
    failures = outcome.reachable ? 0 : failures + 1;
    if (outcome.reachable) next.delete("SupervisionUnreachable");
    else if (failures >= config.offlineThreshold) next.add("SupervisionUnreachable");

    for (const issue of SUPERVISION_ISSUES) {
      if (issue === "SupervisionUnreachable" || outcome.unknown.includes(issue)) continue;
      if (outcome.detected.includes(issue)) next.add(issue);
      else next.delete(issue);
    }
  }

  const opened = [...next].filter((issue) => !previous.has(issue));
  const closed = [...previous].filter((issue) => !next.has(issue));
  const now = new Date();
  const status = outcome.skipped
    ? nvr.status
    : outcome.reachable
      ? "online"
      : next.has("SupervisionUnreachable")
        ? "offline"
        : nvr.status;

  await prisma.$transaction([
    prisma.healthCheck.create({
      data: {
        nvrId: nvr.id,
        ok: outcome.ok,
        reachable: outcome.reachable,
        latencyMs: outcome.latencyMs ?? null,
        issues: outcome.reachable
          ? outcome.detected
          : outcome.skipped
            ? []
            : ["SupervisionUnreachable"],
        message: outcome.skipped ? `Non vérifié — ${outcome.skipped}` : outcome.message,
        details: outcome.details as object,
      },
    }),
    prisma.nvr.update({
      where: { id: nvr.id },
      data: {
        healthIssues: [...next],
        consecutiveFailures: failures,
        lastHealthCheckAt: now,
        status,
        ...(outcome.reachable ? { lastSeen: now } : {}),
      },
    }),
  ]);

  for (const issue of opened) {
    const definition = supervisionDefinition(issue);
    const event = await prisma.nvrEvent.create({
      data: {
        nvrId: nvr.id,
        type: issue,
        code: issue,
        title: definition.title,
        severity: definition.severity,
        source: "supervision",
        payload: {
          issue,
          message: outcome.message,
          consecutiveFailures: failures,
          details: outcome.details,
        } as object,
      },
      select: { id: true },
    });
    void emitAlarmCreated(event.id);
  }

  for (const issue of closed) {
    const events = await prisma.nvrEvent.findMany({
      where: { nvrId: nvr.id, type: issue, source: "supervision", status: { in: OPEN_STATUSES } },
      select: { id: true },
    });
    for (const event of events) {
      await updateEvent(
        event.id,
        { status: "resolved", resolution: "Rétabli — constaté par la supervision automatique" },
        SUPERVISION_ACTOR,
      );
    }
  }

  // Transitions de liaison, relayées comme les autres changements d'état.
  if (status !== nvr.status && status === "offline") void emitNvrStatus(nvr.id, "offline", outcome.message);
  if (status !== nvr.status && status === "online" && nvr.status === "offline") void emitNvrStatus(nvr.id, "online");

  return {
    nvrId: nvr.id,
    ok: outcome.ok,
    reachable: outcome.reachable,
    skipped: outcome.skipped,
    latencyMs: outcome.latencyMs,
    message: outcome.message,
    openIssues: [...next],
    opened,
    closed,
    consecutiveFailures: failures,
  };
}

// ---------------------------------------------------------------------------
// Tournées
// ---------------------------------------------------------------------------

let cycleRunning = false;

export function isCycleRunning(): boolean {
  return cycleRunning;
}

/** Vérifie tous les enregistreurs surveillés. Une seule tournée à la fois. */
export async function runSupervisionCycle(): Promise<{ checked: number; durationMs: number } | null> {
  if (cycleRunning) return null;
  cycleRunning = true;
  const startedAt = Date.now();
  try {
    const config = await getSupervisionConfig();
    const nvrs = await prisma.nvr.findMany({ where: { monitored: true }, select: { id: true } });
    const queue = [...nvrs];
    let checked = 0;
    await Promise.all(
      Array.from({ length: Math.min(CYCLE_CONCURRENCY, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          try {
            await checkNvr(next.id, config);
            checked += 1;
          } catch (error) {
            console.error(`[supervision] ${next.id}`, error);
          }
        }
      }),
    );
    const durationMs = Date.now() - startedAt;
    await prisma.supervisionConfig.update({
      where: { id: "default" },
      data: { lastRunAt: new Date(startedAt), lastRunDurationMs: durationMs, lastRunChecked: checked },
    });
    return { checked, durationMs };
  } finally {
    cycleRunning = false;
  }
}

/** Lance une tournée en arrière-plan ; faux si une tournée est déjà en cours. */
export function triggerSupervisionCycle(): boolean {
  if (cycleRunning) return false;
  void runSupervisionCycle().catch((error) => console.error("[supervision] tournée", error));
  return true;
}

export async function pruneHealthChecks(): Promise<void> {
  await prisma.healthCheck.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - HISTORY_DAYS * 24 * 3600_000) } },
  });
}

let workerStarted = false;

/**
 * Horloge de la supervision, démarrée une fois par processus serveur : toutes
 * les 30 s, lance une tournée si l'intervalle configuré est écoulé.
 */
export function startSupervisionWorker(tickMs = 30_000): void {
  if (workerStarted) return;
  workerStarted = true;
  let lastPrune = 0;
  const timer = setInterval(() => {
    void (async () => {
      try {
        const config = await getSupervisionConfig();
        const due =
          !config.lastRunAt || Date.now() - config.lastRunAt.getTime() >= config.intervalMinutes * 60_000;
        if (config.enabled && due) await runSupervisionCycle();
        if (Date.now() - lastPrune > 24 * 3600_000) {
          lastPrune = Date.now();
          await pruneHealthChecks();
        }
      } catch (error) {
        console.error("[supervision] horloge", error);
      }
    })();
  }, tickMs);
  timer.unref?.();
}

// ---------------------------------------------------------------------------
// Lecture : état et historique d'un enregistreur
// ---------------------------------------------------------------------------

async function uptime(nvrId: string, since: Date) {
  const where = { nvrId, createdAt: { gte: since }, message: { not: { startsWith: "Non vérifié" } } };
  const [total, ok] = await Promise.all([
    prisma.healthCheck.count({ where }),
    prisma.healthCheck.count({ where: { ...where, ok: true } }),
  ]);
  return { total, ok, ratio: total ? ok / total : null };
}

export async function nvrHealth(nvrId: string, historyLimit = 50) {
  const nvr = await prisma.nvr.findUnique({
    where: { id: nvrId },
    select: {
      id: true,
      name: true,
      status: true,
      monitored: true,
      healthIssues: true,
      consecutiveFailures: true,
      lastHealthCheckAt: true,
      lastSeen: true,
    },
  });
  if (!nvr) return null;
  const now = Date.now();
  const [day, week, checks, config] = await Promise.all([
    uptime(nvrId, new Date(now - 24 * 3600_000)),
    uptime(nvrId, new Date(now - 7 * 24 * 3600_000)),
    prisma.healthCheck.findMany({
      where: { nvrId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(historyLimit, 1), 500),
      select: { id: true, ok: true, reachable: true, latencyMs: true, issues: true, message: true, details: true, createdAt: true },
    }),
    getSupervisionConfig(),
  ]);
  return {
    nvr,
    openIssues: (nvr.healthIssues as SupervisionIssue[]).map((issue) => ({
      type: issue,
      ...supervisionDefinition(issue),
    })),
    uptime: { last24h: day, last7d: week },
    supervision: {
      enabled: config.enabled,
      intervalMinutes: config.intervalMinutes,
      offlineThreshold: config.offlineThreshold,
    },
    checks,
  };
}

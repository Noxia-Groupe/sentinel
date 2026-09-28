import { currentTrafficScope, withTraffic } from "@/lib/traffic";
import type { DahuaTarget } from "./http";
import { getDeviceInfo, getStorage } from "./client";
import { withRpc, type RpcSession } from "./rpc";

/**
 * Mesure de l'impact de la supervision sur un enregistreur.
 *
 * Protocole :
 *  1. charge processeur au repos (plusieurs relevés espacés) ;
 *  2. mêmes relevés pendant que Sentinel enchaîne des vérifications de
 *     supervision identiques à celles de la tournée automatique ;
 *  3. coût réseau et durée d'une vérification, puis projection sur la
 *     journée au rythme de supervision configuré.
 *
 * Les relevés eux-mêmes passent par une session RPC ouverte une fois pour
 * toutes : leur coût est de quelques centaines d'octets chacun.
 */

const SAMPLES = 5;
const IDLE_INTERVAL_MS = 1_500;
const LOAD_CHECKS = 3;
/** Durée maximale de la phase sous vérifications. */
const MAX_LOAD_MS = 20_000;
/** Plafond de vérifications enchaînées, pour ne pas surcharger l'équipement. */
const MAX_LOAD_CHECKS = 20;
const MIN_CHECK_SPACING_MS = 250;

type CpuSeries = { samples: number[]; average: number | null; max: number | null };

async function cpuUsage(rpc: RpcSession): Promise<number | null> {
  try {
    const r = await rpc.call<{ usage?: number }>("magicBox.getCPUUsage", { index: 0 });
    return typeof r?.usage === "number" ? r.usage : null;
  } catch {
    return null;
  }
}

function series(values: (number | null)[]): CpuSeries {
  const samples = values.filter((v): v is number => v !== null);
  return {
    samples,
    average: samples.length ? Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10 : null,
    max: samples.length ? Math.max(...samples) : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Une vérification de supervision : identité, heure, disques (comme la tournée). */
async function supervisionCheck(target: DahuaTarget) {
  await getDeviceInfo(target);
  await getStorage(target).catch(() => undefined);
}

export async function measureSupervisionImpact(
  target: DahuaTarget,
  options: { nvrId: string; intervalMinutes: number },
) {
  return withRpc(target, async (rpc) => {
    // 1. Au repos.
    const idle: (number | null)[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      if (i > 0) await sleep(IDLE_INTERVAL_MS);
      idle.push(await cpuUsage(rpc));
    }

    // Trafic imputé à l'auteur de la mesure (utilisateur ou agent).
    const origin = currentTrafficScope()?.origin ?? "interventions";

    // 2. Sous vérifications : relevés en parallèle des vérifications.
    const checks: { durationMs: number; bytesIn: number; bytesOut: number; requests: number }[] = [];
    const loaded: (number | null)[] = [];
    let running = true;
    const sampler = (async () => {
      while (running) {
        loaded.push(await cpuUsage(rpc));
        await sleep(200);
      }
    })();
    // Vérifications enchaînées jusqu'à disposer d'assez de relevés : c'est la
    // charge pendant qu'une vérification s'exécute, pas la moyenne sur 5 min.
    const loadStartedAt = Date.now();
    while (
      checks.length < LOAD_CHECKS ||
      (loaded.length < SAMPLES && checks.length < MAX_LOAD_CHECKS && Date.now() - loadStartedAt < MAX_LOAD_MS)
    ) {
      const startedAt = Date.now();
      const { usage } = await withTraffic(options.nvrId, origin, () => supervisionCheck(target));
      const durationMs = Date.now() - startedAt;
      checks.push({ durationMs, bytesIn: usage.bytesIn, bytesOut: usage.bytesOut, requests: usage.requests });
      // Sur un réseau local, une vérification dure quelques millisecondes :
      // cadence minimale pour laisser aux relevés le temps de la voir.
      if (durationMs < MIN_CHECK_SPACING_MS) await sleep(MIN_CHECK_SPACING_MS - durationMs);
    }
    running = false;
    await sampler;

    const idleSeries = series(idle);
    const loadSeries = series(loaded);
    const avg = (pick: (c: (typeof checks)[number]) => number) =>
      Math.round(checks.reduce((sum, c) => sum + pick(c), 0) / checks.length);
    const perCheck = {
      measuredChecks: checks.length,
      durationMs: avg((c) => c.durationMs),
      bytesIn: avg((c) => c.bytesIn),
      bytesOut: avg((c) => c.bytesOut),
      requests: avg((c) => c.requests),
    };

    const checksPerDay = options.intervalMinutes > 0 ? Math.floor((24 * 60) / options.intervalMinutes) : 0;
    const bytesPerDay = checksPerDay * (perCheck.bytesIn + perCheck.bytesOut);
    const cpuDelta =
      idleSeries.average !== null && loadSeries.average !== null
        ? Math.round((loadSeries.average - idleSeries.average) * 10) / 10
        : null;
    // Part du temps pendant laquelle l'enregistreur est sollicité.
    const busyShare = checksPerDay ? (checksPerDay * perCheck.durationMs) / (24 * 3600_000) : 0;

    return {
      cpu: { idle: idleSeries, duringChecks: loadSeries, deltaPoints: cpuDelta },
      perCheck,
      projection: {
        intervalMinutes: options.intervalMinutes,
        checksPerDay,
        bytesPerDay,
        bytesPerMonth: bytesPerDay * 30,
        /** Débit moyen lissé sur la journée, en octets par seconde. */
        averageBps: Math.round((bytesPerDay / 86_400) * 10) / 10,
        busyPercent: Math.round(busyShare * 1_000_000) / 10_000,
      },
      verdict: verdict(cpuDelta, perCheck.durationMs, busyShare),
    };
  });
}

function verdict(cpuDelta: number | null, durationMs: number, busyShare: number): {
  level: "negligeable" | "faible" | "notable";
  text: string;
} {
  const duration =
    durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  const share = (busyShare * 100).toLocaleString("fr-FR", { maximumSignificantDigits: 2 });
  const pts = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  const busy = `sollicité ${duration} par vérification (${share} % du temps)`;
  if (cpuDelta === null) {
    return { level: "faible", text: `Charge processeur non mesurable sur ce firmware ; enregistreur ${busy}.` };
  }
  if (cpuDelta <= 5) {
    return {
      level: "negligeable",
      text: `Impact négligeable : ${cpuDelta >= 0 ? "+" : ""}${pts(cpuDelta)} point(s) de processeur pendant les vérifications, enregistreur ${busy}.`,
    };
  }
  if (cpuDelta <= 15) {
    return {
      level: "faible",
      text: `Impact faible et bref : +${pts(cpuDelta)} points de processeur pendant les vérifications, enregistreur ${busy}.`,
    };
  }
  return {
    level: "notable",
    text: `Impact notable : +${pts(cpuDelta)} points de processeur pendant les vérifications (enregistreur ${busy}). Espacer la supervision si l'enregistreur est déjà chargé.`,
  };
}

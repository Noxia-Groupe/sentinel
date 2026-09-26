import { clockDriftSeconds } from "@/lib/supervision";
import type { DahuaTarget } from "./http";
import { getDeviceInfo, getStorage } from "./client";
import { attempt, getCameras, getPoeStatus, getSystemStats, isFailure } from "./maintenance";

/**
 * Bilan de maintenance d'un enregistreur : un seul passage sur l'équipement
 * (identité, disques, charge, caméras, PoE, horloge), puis des constats
 * classés par gravité avec l'action recommandée pour chacun.
 *
 * C'est l'outil de la maintenance préventive (bilan périodique) comme du
 * diagnostic curatif (point de départ après une panne) — pour un technicien
 * comme pour un agent (Hermes). Les recommandations nomment l'action
 * Sentinel correspondante (`sync-time`, `poe-power`…) : l'agent peut
 * l'enchaîner directement.
 */

export type FindingLevel = "critical" | "warning" | "info";

export type MaintenanceFinding = {
  level: FindingLevel;
  domain: "disques" | "horloge" | "systeme" | "reseau" | "cameras" | "poe" | "firmware" | "diagnostic";
  message: string;
  recommendation?: string;
  /** Action Sentinel qui traite le constat, si elle existe. */
  action?: { name: string; params?: Record<string, unknown> };
};

const CPU_WARNING = 85;
const MEMORY_WARNING = 90;
/** Au-delà, un redémarrage préventif planifié est conseillé. */
const LONG_UPTIME_DAYS = 180;
/** En deçà, l'équipement a redémarré récemment : coupure secteur ou plantage ? */
const RECENT_REBOOT_SECONDS = 3600;
const OLD_FIRMWARE_YEARS = 3;

const LEVEL_ORDER: Record<FindingLevel, number> = { critical: 0, warning: 1, info: 2 };

function days(seconds: number): number {
  return Math.floor(seconds / 86_400);
}

/**
 * Date de compilation du firmware : champ dédié (`2023-06-12`, `20230612`…)
 * ou mention « build » dans la version (`4.001.0000000.1,build:2021-03-15`).
 */
function parseBuildDate(buildDate: string | undefined, version: string | undefined): Date | undefined {
  const m =
    (buildDate ? /(\d{4})-?(\d{2})-?(\d{2})/.exec(buildDate) : null) ??
    (version ? /build\D{0,3}(\d{4})-?(\d{2})-?(\d{2})/i.exec(version) : null);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
}

export async function buildMaintenanceReport(
  target: DahuaTarget,
  options: { clockDriftMinutes?: number } = {},
) {
  const driftThreshold = (options.clockDriftMinutes ?? 5) * 60;

  // Séquentiel : ménage la liaison (tunnel P2P, ADSL de site) et le firmware.
  const device = await attempt(() => getDeviceInfo(target));
  const storage = await attempt(() => getStorage(target));
  const stats = await attempt(() => getSystemStats(target));
  const cameras = await attempt(() => getCameras(target));
  const poe = await attempt(() => getPoeStatus(target));

  const findings: MaintenanceFinding[] = [];
  const unavailable = (what: string, error: string) => {
    findings.push({ level: "info", domain: "diagnostic", message: `${what} indisponible : ${error}` });
  };

  // --- Identité, horloge, firmware ---
  let driftSeconds: number | undefined;
  if (isFailure(device)) {
    unavailable("Informations équipement", device.error);
  } else {
    driftSeconds = device.deviceTime ? clockDriftSeconds(device.deviceTime) : undefined;
    if (driftSeconds !== undefined && Math.abs(driftSeconds) > driftThreshold) {
      findings.push({
        level: "warning",
        domain: "horloge",
        message: `Horloge décalée de ${Math.round(driftSeconds / 60)} min — les enregistrements sont mal horodatés`,
        recommendation: "Remettre à l'heure, puis vérifier le serveur NTP de l'enregistreur",
        action: { name: "sync-time" },
      });
    }
    const built = parseBuildDate(device.buildDate, device.softwareVersion);
    if (built && Date.now() - built.getTime() > OLD_FIRMWARE_YEARS * 365 * 86_400_000) {
      findings.push({
        level: "info",
        domain: "firmware",
        message: `Firmware ${device.softwareVersion ?? ""} compilé le ${built.toISOString().slice(0, 10)} (plus de ${OLD_FIRMWARE_YEARS} ans)`,
        recommendation: "Vérifier sur le portail Dahua si une mise à jour corrige des failles ou des défauts connus",
      });
    }
  }

  // --- Disques ---
  if (isFailure(storage)) {
    unavailable("État des disques", storage.error);
  } else if (storage.length === 0) {
    findings.push({
      level: "critical",
      domain: "disques",
      message: "Aucun disque détecté : l'enregistreur n'enregistre rien",
      recommendation: "Intervention sur site : installer ou reconnecter le disque",
    });
  } else {
    for (const disk of storage.filter((d) => !d.healthy)) {
      findings.push({
        level: "critical",
        domain: "disques",
        message: `Disque ${disk.name} en erreur (état ${disk.state ?? "inconnu"})`,
        recommendation: "Planifier le remplacement du disque ; les enregistrements récents peuvent manquer",
      });
    }
  }

  // --- Charge système ---
  if (isFailure(stats)) {
    unavailable("Charge système", stats.error);
  } else {
    if (!isFailure(stats.cpu) && stats.cpu.usagePercent >= CPU_WARNING) {
      findings.push({
        level: "warning",
        domain: "systeme",
        message: `Processeur chargé à ${stats.cpu.usagePercent} %`,
        recommendation:
          "Vérifier les analyses intelligentes activées et les flux relus à distance ; réduire les débits si la charge persiste",
      });
    }
    if (!isFailure(stats.memory) && stats.memory.usedPercent >= MEMORY_WARNING) {
      findings.push({
        level: "warning",
        domain: "systeme",
        message: `Mémoire occupée à ${stats.memory.usedPercent} %`,
        recommendation: "Un redémarrage planifié hors heures d'exploitation libère la mémoire",
      });
    }
    if (!isFailure(stats.uptime)) {
      if (stats.uptime.seconds < RECENT_REBOOT_SECONDS) {
        findings.push({
          level: "warning",
          domain: "systeme",
          message: `Redémarré il y a ${Math.round(stats.uptime.seconds / 60)} min`,
          recommendation:
            "Si ce redémarrage n'était pas prévu : consulter le journal (action logs) — coupure secteur ou plantage ?",
          action: { name: "logs", params: { hours: 2 } },
        });
      } else if (days(stats.uptime.seconds) >= LONG_UPTIME_DAYS) {
        findings.push({
          level: "info",
          domain: "systeme",
          message: `En fonctionnement depuis ${days(stats.uptime.seconds)} jours sans redémarrage`,
          recommendation: "Un redémarrage préventif planifié (nuit, hors exploitation) est conseillé",
        });
      }
    }
    if (!isFailure(stats.interfaces)) {
      for (const nic of stats.interfaces.filter((n) => n.connected && n.speedMbps !== null && n.speedMbps < 100)) {
        findings.push({
          level: "warning",
          domain: "reseau",
          message: `Interface ${nic.name} négociée à ${nic.speedMbps} Mbit/s`,
          recommendation: "Lien dégradé : contrôler le câble et le port du commutateur",
        });
      }
    }
  }

  // --- Caméras et PoE ---
  const poePorts = !isFailure(poe) ? poe.ports : [];
  const poeControllable = !isFailure(poe) && poe.controllable;
  /** Ports coupés déjà expliqués par une caméra en perte vidéo. */
  const explainedPorts = new Set<number>();
  if (isFailure(cameras)) {
    unavailable("État des caméras", cameras.error);
  } else {
    for (const camera of cameras.cameras.filter((c) => c.online === false)) {
      const label = `Voie ${camera.channel}${camera.title ? ` (${camera.title})` : ""}`;
      const port = poeControllable ? poePorts.find((p) => p.port === camera.channel && p.enabled !== null) : undefined;
      if (port?.enabled === false) {
        // Port coupé : cause la plus probable, et la plus simple à lever.
        explainedPorts.add(port.port);
        findings.push({
          level: "warning",
          domain: "cameras",
          message: `${label} en perte vidéo — le port PoE ${port.port} est coupé`,
          recommendation: `Rétablir l'alimentation du port PoE ${port.port}, puis vérifier le retour de l'image`,
          action: { name: "poe-power", params: { port: port.port, mode: "on" } },
        });
      } else {
        findings.push({
          level: "warning",
          domain: "cameras",
          message: `${label} en perte vidéo`,
          recommendation: port
            ? `Redémarrer l'alimentation du port PoE ${port.port} (vérifier d'abord que la caméra y est bien branchée) ; si elle ne revient pas : câble ou caméra à contrôler sur site`
            : "Vérifier l'alimentation et le câble de la caméra, puis son adresse réseau",
          ...(port ? { action: { name: "poe-power", params: { port: port.port, mode: "cycle" } } } : {}),
        });
      }
    }
  }
  for (const port of poePorts.filter((p) => p.enabled === false && !explainedPorts.has(p.port))) {
    findings.push({
      level: "info",
      domain: "poe",
      message: `Port PoE ${port.port} coupé`,
      recommendation: "Normal si aucune caméra n'y est branchée ; sinon le rétablir",
      action: { name: "poe-power", params: { port: port.port, mode: "on" } },
    });
  }

  findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const status: "ok" | FindingLevel = findings.some((f) => f.level === "critical")
    ? "critical"
    : findings.some((f) => f.level === "warning")
      ? "warning"
      : "ok";

  return {
    generatedAt: new Date().toISOString(),
    status,
    findings,
    device: isFailure(device)
      ? null
      : {
          model: device.deviceType ?? null,
          serialNumber: device.serialNumber ?? null,
          firmware: device.softwareVersion ?? null,
          buildDate: device.buildDate ?? null,
          deviceTime: device.deviceTime ?? null,
          clockDriftSeconds: driftSeconds ?? null,
        },
    disks: isFailure(storage)
      ? null
      : storage.map((d) => ({
          name: d.name,
          healthy: d.healthy,
          state: d.state ?? null,
          usedPercent:
            d.totalBytes && d.usedBytes !== undefined ? Math.round((d.usedBytes / d.totalBytes) * 1000) / 10 : null,
          totalBytes: d.totalBytes ?? null,
        })),
    system: isFailure(stats)
      ? null
      : {
          cpuPercent: isFailure(stats.cpu) ? null : stats.cpu.usagePercent,
          memoryPercent: isFailure(stats.memory) ? null : stats.memory.usedPercent,
          uptimeSeconds: isFailure(stats.uptime) ? null : stats.uptime.seconds,
          interfaces: isFailure(stats.interfaces) ? null : stats.interfaces,
        },
    cameras: isFailure(cameras)
      ? null
      : {
          ...cameras.summary,
          offlineChannels: cameras.cameras.filter((c) => c.online === false).map((c) => c.channel),
        },
    poe: isFailure(poe)
      ? null
      : {
          controllable: poe.controllable,
          ports: poe.ports.map((p) => ({ port: p.port, enabled: p.enabled })),
        },
  };
}

export type MaintenanceReport = Awaited<ReturnType<typeof buildMaintenanceReport>>;

import type { Actor } from "@/lib/actor";
import { DahuaError, type DahuaFailureReason, type DahuaTarget } from "./http";
import { runNvrAction, type NvrWithCredentials } from "./service";
import {
  DEVICE_TIME_ZONE,
  getAlarmOutState,
  getChannelTitles,
  getDeviceInfo,
  getEventIndexes,
  getStorage,
  getUsers,
  reboot,
  setAlarmOut,
  setDeviceTime,
  snapshot,
  summarizeRights,
} from "./client";
import {
  advancedRead,
  getCameras,
  getCapabilities,
  getLogs,
  getPoeStatus,
  getSystemStats,
  setPoePower,
} from "./maintenance";
import { buildMaintenanceReport } from "./maintenance-report";
import { getSupervisionConfig } from "@/lib/supervision";
import {
  alarmDestination,
  configureAlarmCenter,
  readAlarmCenter,
  type AlarmScheme,
} from "./alarm-center";

/**
 * Catalogue des interventions à distance disponibles sur un enregistreur.
 * Il est partagé par l'interface et par l'API des agents : ajouter une action
 * ici suffit à l'exposer aux deux.
 */

export type NvrActionName =
  | "device-info"
  | "users"
  | "channels"
  | "storage"
  | "alarm-out-state"
  | "alarm-center"
  | "event-indexes"
  | "snapshot"
  | "maintenance-report"
  | "system-stats"
  | "cameras"
  | "poe-status"
  | "logs"
  | "capabilities"
  | "advanced-read"
  | "sync-time"
  | "poe-power"
  | "alarm-out"
  | "configure-alarm-center"
  | "reboot";

export type NvrActionDefinition = {
  label: string;
  description: string;
  /** `read` : simple consultation. `control` : agit sur l'équipement. */
  kind: "read" | "control";
  /** Scope d'API requis pour les agents. */
  scope: "nvr:test" | "nvr:control";
};

export const NVR_ACTIONS: Record<NvrActionName, NvrActionDefinition> = {
  "device-info": {
    label: "Informations équipement",
    description: "Modèle, numéro de série, firmware et heure de l'enregistreur",
    kind: "read",
    scope: "nvr:test",
  },
  users: {
    label: "Comptes de l'enregistreur",
    description: "Liste des comptes déclarés sur l'équipement et leurs droits",
    kind: "read",
    scope: "nvr:test",
  },
  channels: {
    label: "Titres des canaux",
    description: "Nom de chaque caméra tel que configuré sur l'enregistreur",
    kind: "read",
    scope: "nvr:test",
  },
  storage: {
    label: "État des disques",
    description: "Capacité, occupation et état des disques durs",
    kind: "read",
    scope: "nvr:test",
  },
  "alarm-out-state": {
    label: "État des sorties d'alarme",
    description: "Position des relais de sortie",
    kind: "read",
    scope: "nvr:test",
  },
  "alarm-center": {
    label: "Centre d'alarme configuré",
    description:
      "Destination vers laquelle l'enregistreur remonte ses alarmes, telle qu'elle est réglée sur l'équipement",
    kind: "read",
    scope: "nvr:test",
  },
  "event-indexes": {
    label: "Canaux en alarme",
    description: "Canaux actuellement en alarme pour un code donné (paramètre `code`)",
    kind: "read",
    scope: "nvr:test",
  },
  snapshot: {
    label: "Capture d'image",
    description: "Image instantanée d'un canal (paramètre `channel`), renvoyée en base64",
    kind: "read",
    scope: "nvr:test",
  },
  "maintenance-report": {
    label: "Bilan de maintenance",
    description:
      "Passage complet (disques, horloge, charge, caméras, PoE, firmware) et constats classés par gravité, " +
      "chacun avec l'action recommandée — point de départ du préventif comme du curatif",
    kind: "read",
    scope: "nvr:test",
  },
  "system-stats": {
    label: "Charge système",
    description:
      "Processeur, mémoire, temps de fonctionnement et interfaces réseau (vitesse de lien), plus les statistiques de débit / PoE propres au firmware",
    kind: "read",
    scope: "nvr:test",
  },
  cameras: {
    label: "État des caméras",
    description:
      "Par voie : titre, en ligne ou en perte vidéo, adresse et modèle de la caméra, flux principal et secondaire (codec, résolution, images/s, débit maximal configuré)",
    kind: "read",
    scope: "nvr:test",
  },
  "poe-status": {
    label: "Ports PoE",
    description: "État d'alimentation de chaque port PoE et informations PoE exposées par le firmware",
    kind: "read",
    scope: "nvr:test",
  },
  logs: {
    label: "Journal de l'enregistreur",
    description: "Dernières entrées du journal système (paramètres `hours`, 24 par défaut, et `limit`, 100 par défaut)",
    kind: "read",
    scope: "nvr:test",
  },
  capabilities: {
    label: "Capacités du firmware",
    description:
      "Diagnostic : méthodes RPC exposées par l'équipement (PoE, réseau, système…) et sections de configuration présentes",
    kind: "read",
    scope: "nvr:test",
  },
  "advanced-read": {
    label: "Lecture avancée (RPC)",
    description:
      "Appel RPC2 en lecture seule (paramètres `method` — get…, list…, query…, configManager.getConfig — et `params`)",
    kind: "read",
    scope: "nvr:test",
  },
  "poe-power": {
    label: "Alimentation d'un port PoE",
    description:
      "Coupe, rétablit ou redémarre l'alimentation d'un port PoE (paramètres `port`, `mode` on|off|cycle, `offSeconds` pour cycle, `dryRun`) — relance une caméra figée",
    kind: "control",
    scope: "nvr:control",
  },
  "sync-time": {
    label: "Mise à l'heure",
    description:
      "Aligne l'horloge de l'enregistreur sur l'heure légale de son fuseau " +
      "(Europe/Paris par défaut, heure d'été/hiver comprise — DAHUA_TIME_ZONE)",
    kind: "control",
    scope: "nvr:control",
  },
  "alarm-out": {
    label: "Pilotage d'une sortie d'alarme",
    description: "Active ou relâche un relais (paramètres `index` et `active`)",
    kind: "control",
    scope: "nvr:control",
  },
  "configure-alarm-center": {
    label: "Déclarer SENTINEL comme centre d'alarme",
    description:
      "Écrit l'adresse de la plateforme dans les paramètres d'alarme de l'enregistreur, en HTTPS " +
      "par défaut (paramètres : `scheme` http|https, `dryRun` pour simuler, `section`, `fields` pour forcer des champs)",
    kind: "control",
    scope: "nvr:control",
  },
  reboot: {
    label: "Redémarrage",
    description: "Redémarre l'enregistreur — coupe l'enregistrement pendant la séquence",
    kind: "control",
    scope: "nvr:control",
  },
};

export function isNvrAction(value: unknown): value is NvrActionName {
  return typeof value === "string" && value in NVR_ACTIONS;
}

export type ActionParams = Record<string, unknown>;

export type ActionOutcome =
  | { ok: true; data: unknown }
  | { ok: false; reason: DahuaFailureReason; message: string };

function numberParam(params: ActionParams, name: string, fallback: number): number {
  const value = Number(params[name]);
  return Number.isFinite(value) ? value : fallback;
}

/** Exécute une action distante, avec journalisation d'audit intégrée. */
export async function executeNvrAction(options: {
  nvr: NvrWithCredentials;
  action: NvrActionName;
  params?: ActionParams;
  credentialId?: string | null;
  actor: Actor;
}): Promise<ActionOutcome> {
  const { nvr, action, params = {}, credentialId, actor } = options;

  const run = async (target: DahuaTarget): Promise<unknown> => {
    switch (action) {
      case "device-info":
        return getDeviceInfo(target);

      case "users": {
        const users = await getUsers(target);
        return users.map((user) => ({ ...user, summary: summarizeRights(user) }));
      }

      case "channels":
        return getChannelTitles(target);

      case "storage":
        return getStorage(target);

      case "alarm-out-state":
        return { states: await getAlarmOutState(target) };

      case "alarm-center": {
        const current = await readAlarmCenter(target);
        const expected = alarmDestination(nvr.webhookToken);
        return {
          // Ce que l'enregistreur enverrait s'il était correctement provisionné.
          expected,
          configured: current?.config ?? null,
          section: current?.section ?? null,
          supported: current !== null,
        };
      }

      case "event-indexes": {
        const code = typeof params.code === "string" ? params.code : "VideoMotion";
        return { code, channels: await getEventIndexes(target, code) };
      }

      case "snapshot": {
        const channel = numberParam(params, "channel", 1);
        const image = await snapshot(target, channel);
        return {
          channel,
          contentType: "image/jpeg",
          base64: image.toString("base64"),
          bytes: image.length,
        };
      }

      case "maintenance-report": {
        // Même seuil de dérive d'horloge que la supervision permanente.
        const config = await getSupervisionConfig();
        return buildMaintenanceReport(target, { clockDriftMinutes: config.clockDriftMinutes || 5 });
      }

      case "system-stats":
        return getSystemStats(target);

      case "cameras":
        return getCameras(target);

      case "poe-status":
        return getPoeStatus(target);

      case "logs":
        return getLogs(target, {
          hours: numberParam(params, "hours", 24),
          limit: numberParam(params, "limit", 100),
        });

      case "capabilities":
        return getCapabilities(target);

      case "advanced-read": {
        const method = typeof params.method === "string" ? params.method.trim() : "";
        return advancedRead(target, method, params.params);
      }

      case "poe-power": {
        const mode = params.mode === "on" || params.mode === "off" || params.mode === "cycle" ? params.mode : null;
        if (!mode) throw new DahuaError("invalid", "Paramètre « mode » attendu : on, off ou cycle");
        const port = numberParam(params, "port", 0);
        if (port < 1) throw new DahuaError("invalid", "Paramètre « port » attendu (1, 2, …)");
        return setPoePower(target, {
          port,
          mode,
          dryRun: params.dryRun === true || params.dryRun === "true",
          offSeconds: numberParam(params, "offSeconds", 10),
        });
      }

      case "sync-time": {
        const applied = await setDeviceTime(target);
        return { time: applied, timeZone: DEVICE_TIME_ZONE };
      }

      case "alarm-out": {
        const index = numberParam(params, "index", 0);
        const active = params.active === true || params.active === "true";
        await setAlarmOut(target, index, active);
        return { index, active };
      }

      case "configure-alarm-center": {
        const scheme =
          params.scheme === "http" || params.scheme === "https"
            ? (params.scheme as AlarmScheme)
            : undefined;
        const fields =
          typeof params.fields === "object" && params.fields !== null
            ? Object.fromEntries(
                Object.entries(params.fields as Record<string, unknown>).map(([key, value]) => [
                  key,
                  String(value),
                ]),
              )
            : undefined;

        return configureAlarmCenter({
          target,
          webhookToken: nvr.webhookToken,
          scheme,
          section: typeof params.section === "string" ? params.section : undefined,
          overrides: fields,
          dryRun: params.dryRun === true || params.dryRun === "true",
        });
      }

      case "reboot":
        await reboot(target);
        return { rebooting: true };
    }
  };

  return runNvrAction({
    nvr,
    credentialId,
    action: `nvr.${action}`,
    actor,
    metadata: { params },
    run,
  });
}

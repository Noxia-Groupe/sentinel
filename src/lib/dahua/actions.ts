import type { Actor } from "@/lib/actor";
import type { DahuaFailureReason, DahuaTarget } from "./http";
import { runNvrAction, type NvrWithCredentials } from "./service";
import {
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
  | "event-indexes"
  | "snapshot"
  | "sync-time"
  | "alarm-out"
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
  "sync-time": {
    label: "Mise à l'heure",
    description: "Aligne l'horloge de l'enregistreur sur celle du serveur",
    kind: "control",
    scope: "nvr:control",
  },
  "alarm-out": {
    label: "Pilotage d'une sortie d'alarme",
    description: "Active ou relâche un relais (paramètres `index` et `active`)",
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

      case "sync-time": {
        const applied = await setDeviceTime(target);
        return { time: applied };
      }

      case "alarm-out": {
        const index = numberParam(params, "index", 0);
        const active = params.active === true || params.active === "true";
        await setAlarmOut(target, index, active);
        return { index, active };
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

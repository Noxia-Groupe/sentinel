/**
 * Normalisation des événements Dahua.
 *
 * Les enregistreurs poussent des payloads très hétérogènes selon le firmware
 * (JSON, formulaire, query string, texte brut). On en extrait toujours les
 * mêmes champs : code, libellé lisible, criticité, canal.
 */

export type EventSeverity = "critical" | "major" | "minor" | "info";

export type NormalizedEvent = {
  /** Code technique normalisé (VideoMotion, StorageFailure…). */
  type: string;
  /** Code brut tel que renvoyé par l'équipement. */
  code?: string;
  title: string;
  severity: EventSeverity;
  channel?: number;
  /** "Start" | "Stop" | "Pulse" — un `Stop` est purement informatif. */
  action?: string;
};

type EventDefinition = { title: string; severity: EventSeverity };

/**
 * Table des codes Dahua rencontrés en exploitation. Les codes inconnus
 * retombent sur une criticité `minor` et conservent leur libellé brut.
 */
const EVENT_CATALOG: Record<string, EventDefinition> = {
  // Intrusion / analyse d'image
  crosslinedetection: { title: "Franchissement de ligne", severity: "major" },
  crossregiondetection: { title: "Intrusion en zone", severity: "major" },
  leftdetection: { title: "Objet abandonné", severity: "major" },
  takenawaydetection: { title: "Objet retiré", severity: "major" },
  parkingdetection: { title: "Stationnement anormal", severity: "minor" },
  loiteringdetection: { title: "Maraudage détecté", severity: "major" },
  wanderdetection: { title: "Errance détectée", severity: "major" },
  smartmotionhuman: { title: "Détection de personne", severity: "major" },
  smartmotionvehicle: { title: "Détection de véhicule", severity: "minor" },
  facedetection: { title: "Visage détecté", severity: "info" },
  facerecognition: { title: "Visage reconnu", severity: "info" },
  numberstat: { title: "Comptage de personnes", severity: "info" },

  // Vidéo
  videomotion: { title: "Détection de mouvement", severity: "minor" },
  videoloss: { title: "Perte du signal vidéo", severity: "major" },
  videoblind: { title: "Caméra masquée", severity: "major" },
  videoabnormaldetection: { title: "Anomalie vidéo", severity: "major" },
  videounfocus: { title: "Image floue", severity: "minor" },
  scenechange: { title: "Changement de scène", severity: "major" },

  // Entrées / sorties d'alarme
  alarmlocal: { title: "Alarme sur entrée locale", severity: "major" },
  alarmoutput: { title: "Sortie d'alarme activée", severity: "info" },
  alarmbell: { title: "Sirène déclenchée", severity: "major" },
  externalalarm: { title: "Alarme externe", severity: "major" },

  // Stockage
  storagenotexist: { title: "Disque absent", severity: "critical" },
  storagefailure: { title: "Défaut disque", severity: "critical" },
  storagelowspace: { title: "Espace disque faible", severity: "major" },
  diskfull: { title: "Disque plein", severity: "major" },
  hddfull: { title: "Disque plein", severity: "major" },
  nodisk: { title: "Aucun disque détecté", severity: "critical" },
  recordfailure: { title: "Échec d'enregistrement", severity: "critical" },

  // Réseau / système
  netabort: { title: "Perte du réseau", severity: "critical" },
  ipconflict: { title: "Conflit d'adresse IP", severity: "major" },
  loginfailure: { title: "Échec de connexion", severity: "major" },
  reboot: { title: "Redémarrage de l'enregistreur", severity: "major" },
  shutdown: { title: "Arrêt de l'enregistreur", severity: "critical" },
  poweroff: { title: "Coupure d'alimentation", severity: "critical" },
  fanspeedalarm: { title: "Défaut de ventilation", severity: "major" },
  temperaturealarm: { title: "Température anormale", severity: "major" },
  firewarning: { title: "Détection incendie", severity: "critical" },
  safetyabnormal: { title: "Anomalie de sécurité", severity: "major" },

  // Fonctionnement normal
  newfile: { title: "Nouveau fichier enregistré", severity: "info" },
  intelliframe: { title: "Image d'analyse", severity: "info" },
  heartbeat: { title: "Test de liaison", severity: "info" },
  keepalive: { title: "Test de liaison", severity: "info" },
};

/** Champs susceptibles de porter le code de l'événement selon le firmware. */
const CODE_KEYS = ["Code", "code", "eventType", "EventType", "event", "type", "AlarmType", "alarmType", "EventCode"];
const CHANNEL_KEYS = ["index", "Index", "channel", "Channel", "ChannelNo", "chn"];
const ACTION_KEYS = ["action", "Action", "eventAction"];

function flatten(payload: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || typeof payload !== "object" || payload === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Les sous-objets (`data`, `Data`, `info`) sont aplatis : le code peut
      // s'y trouver plutôt qu'à la racine.
      Object.assign(out, flatten(value, depth + 1));
    }
    // La racine prime sur les sous-objets.
    if (!(key in out) || value !== null) out[key] = value;
  }
  return out;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toChannel(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  // Dahua indexe les canaux à partir de 0 dans les notifications d'alarme,
  // alors que l'affichage des NVR commence à 1.
  return parsed + 1;
}

export function normalizeEvent(payload: unknown): NormalizedEvent {
  const flat = flatten(payload);

  const rawCode = pick(flat, CODE_KEYS);
  const code = rawCode === undefined ? undefined : String(rawCode).trim();
  const action = pick(flat, ACTION_KEYS);
  const channel = toChannel(pick(flat, CHANNEL_KEYS));

  if (!code) {
    return {
      type: "unknown",
      title: "Événement non identifié",
      severity: "info",
      channel,
      action: action === undefined ? undefined : String(action),
    };
  }

  const definition = EVENT_CATALOG[code.toLowerCase()];
  const actionLabel = String(action ?? "");

  return {
    type: code,
    code,
    title: definition?.title ?? code,
    // Une fin d'alarme (`Stop`) ne doit pas ressortir au même niveau que son début.
    severity: actionLabel.toLowerCase() === "stop" ? "info" : (definition?.severity ?? "minor"),
    channel,
    action: action === undefined ? undefined : actionLabel,
  };
}

export const SEVERITIES: EventSeverity[] = ["critical", "major", "minor", "info"];

export const SEVERITY_LABELS: Record<EventSeverity, string> = {
  critical: "Critique",
  major: "Majeure",
  minor: "Mineure",
  info: "Information",
};

export type EventStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "ignored";

export const EVENT_STATUSES: EventStatus[] = [
  "new",
  "acknowledged",
  "in_progress",
  "resolved",
  "ignored",
];

export const STATUS_LABELS: Record<EventStatus, string> = {
  new: "Nouvelle",
  acknowledged: "Prise en compte",
  in_progress: "En traitement",
  resolved: "Clôturée",
  ignored: "Ignorée",
};

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (EVENT_STATUSES as string[]).includes(value);
}

export function isSeverity(value: unknown): value is EventSeverity {
  return typeof value === "string" && (SEVERITIES as string[]).includes(value);
}

/**
 * Familles d'événements, pour filtrer ce qui part vers un webhook sortant
 * (« toutes les pannes de stockage », « intrusions seulement »…).
 */
export type EventCategory = "intrusion" | "video" | "io" | "storage" | "system" | "other";

export const EVENT_CATEGORIES: EventCategory[] = [
  "intrusion",
  "video",
  "io",
  "storage",
  "system",
  "other",
];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  intrusion: "Intrusion et analyse d'image",
  video: "Vidéo (perte, masquage, anomalie)",
  io: "Entrées / sorties d'alarme",
  storage: "Stockage (disques, enregistrement)",
  system: "Réseau et système (pannes, alimentation, température)",
  other: "Autres événements",
};

const CATEGORY_BY_TYPE: Record<string, EventCategory> = {
  crosslinedetection: "intrusion",
  crossregiondetection: "intrusion",
  leftdetection: "intrusion",
  takenawaydetection: "intrusion",
  parkingdetection: "intrusion",
  loiteringdetection: "intrusion",
  wanderdetection: "intrusion",
  smartmotionhuman: "intrusion",
  smartmotionvehicle: "intrusion",
  facedetection: "intrusion",
  facerecognition: "intrusion",
  numberstat: "intrusion",
  videomotion: "video",
  videoloss: "video",
  videoblind: "video",
  videoabnormaldetection: "video",
  videounfocus: "video",
  scenechange: "video",
  alarmlocal: "io",
  alarmoutput: "io",
  alarmbell: "io",
  externalalarm: "io",
  storagenotexist: "storage",
  storagefailure: "storage",
  storagelowspace: "storage",
  diskfull: "storage",
  hddfull: "storage",
  nodisk: "storage",
  recordfailure: "storage",
  netabort: "system",
  ipconflict: "system",
  loginfailure: "system",
  reboot: "system",
  shutdown: "system",
  poweroff: "system",
  fanspeedalarm: "system",
  temperaturealarm: "system",
  firewarning: "system",
  safetyabnormal: "system",
};

export function eventCategory(type: string): EventCategory {
  return CATEGORY_BY_TYPE[type.toLowerCase()] ?? "other";
}

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === "string" && (EVENT_CATEGORIES as string[]).includes(value);
}

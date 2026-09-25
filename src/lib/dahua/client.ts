import { DahuaError, dahuaRequest, dahuaRequestText, type DahuaTarget } from "./http";
import { getString, parseKeyValue, type DahuaObject, type DahuaValue } from "./parse";

/**
 * Opérations métier sur un enregistreur Dahua (NVR/XVR/IPC) via l'API CGI.
 *
 * Toutes les fonctions lèvent une `DahuaError` typée : les appelants
 * (routes API, service de test) la traduisent en réponse HTTP.
 */

export type DeviceInfo = {
  deviceType?: string;
  serialNumber?: string;
  hardwareVersion?: string;
  processor?: string;
  softwareVersion?: string;
  buildDate?: string;
  machineName?: string;
  deviceTime?: string;
  videoInputChannels?: number;
  videoOutputChannels?: number;
};

export type DeviceUser = {
  name: string;
  group?: string;
  memo?: string;
  authorities: string[];
  reserved?: boolean;
};

export type RightsSummary = {
  /** false quand le compte testé n'a pas le droit de lister les utilisateurs. */
  available: boolean;
  unavailableReason?: string;
  username: string;
  group?: string;
  memo?: string;
  isAdmin: boolean;
  authorities: string[];
  capabilities: {
    liveView: boolean;
    playback: boolean;
    ptz: boolean;
    record: boolean;
    backup: boolean;
    configure: boolean;
    userManagement: boolean;
    reboot: boolean;
  };
  channels: {
    liveView: number[];
    playback: number[];
    ptz: number[];
  };
};

async function get(target: DahuaTarget, path: string): Promise<DahuaObject> {
  return parseKeyValue(await dahuaRequestText(target, path));
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Infos d'identification de l'équipement (modèle, SN, firmware, heure). */
export async function getDeviceInfo(target: DahuaTarget): Promise<DeviceInfo> {
  const system = await get(target, "/cgi-bin/magicBox.cgi?action=getSystemInfo");

  // Les appels suivants sont facultatifs : certains firmwares ou comptes
  // restreints ne les exposent pas, ce n'est pas une raison d'échouer.
  const [version, name, time, caps] = await Promise.all([
    get(target, "/cgi-bin/magicBox.cgi?action=getSoftwareVersion").catch(() => ({}) as DahuaObject),
    get(target, "/cgi-bin/magicBox.cgi?action=getMachineName").catch(() => ({}) as DahuaObject),
    get(target, "/cgi-bin/global.cgi?action=getCurrentTime").catch(() => ({}) as DahuaObject),
    get(target, "/cgi-bin/devVideoInput.cgi?action=getCollect").catch(() => ({}) as DahuaObject),
  ]);

  return {
    deviceType: getString(system, "deviceType"),
    serialNumber: getString(system, "serialNumber"),
    hardwareVersion: getString(system, "hardwareVersion"),
    processor: getString(system, "processor"),
    softwareVersion:
      getString(version, "version") ?? getString(version, "software.Version"),
    buildDate: getString(version, "BuildDate") ?? getString(version, "build"),
    machineName: getString(name, "name") ?? getString(name, "machineName"),
    deviceTime: getString(time, "result") ?? getString(time, "time"),
    videoInputChannels: toNumber(getString(caps, "channels")),
    videoOutputChannels: undefined,
  };
}

/**
 * Test de connexion : vérifie la joignabilité **et** la validité du compte.
 * Retourne la latence mesurée sur l'appel authentifié.
 */
export async function testConnection(
  target: DahuaTarget,
): Promise<{ latencyMs: number; device: DeviceInfo }> {
  const startedAt = Date.now();
  const device = await getDeviceInfo(target);
  return { latencyMs: Date.now() - startedAt, device };
}

/** Liste complète des comptes déclarés sur l'équipement. */
export async function getUsers(target: DahuaTarget): Promise<DeviceUser[]> {
  const parsed = await get(target, "/cgi-bin/userManager.cgi?action=getUserInfoAll");
  const raw = parsed.users;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry): entry is DahuaObject => typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      name: String(entry.Name ?? entry.name ?? ""),
      group: entry.Group !== undefined ? String(entry.Group) : undefined,
      memo: entry.Memo !== undefined ? String(entry.Memo) : undefined,
      reserved: entry.Reserved === true,
      authorities: toStringArray(entry.AuthorityList),
    }))
    .filter((user) => user.name.length > 0);
}

function toStringArray(value: DahuaValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" || typeof item === "number").map(String);
}

/** Numéros de canaux portés par une autorité du type `Monitor_02`. */
function channelsFor(authorities: string[], prefix: string): number[] {
  const channels: number[] = [];
  for (const authority of authorities) {
    const match = new RegExp(`^${prefix}_(\\d+)$`, "i").exec(authority);
    if (match) channels.push(Number(match[1]));
  }
  return [...new Set(channels)].sort((a, b) => a - b);
}

function has(authorities: string[], ...names: string[]): boolean {
  const lower = authorities.map((a) => a.toLowerCase());
  return names.some((name) => lower.includes(name.toLowerCase()));
}

function hasPrefix(authorities: string[], prefix: string): boolean {
  const lower = prefix.toLowerCase();
  return authorities.some((a) => a.toLowerCase().startsWith(`${lower}_`));
}

/**
 * Les noms d'autorités varient selon les générations de firmware :
 * `Playback_01` ou `Replay_01` pour la relecture, `UserManage` ou `AuthUserMag`
 * pour la gestion des comptes, etc. On accepte les deux familles.
 */
export function summarizeRights(user: DeviceUser): RightsSummary {
  const authorities = user.authorities;
  const isAdmin = (user.group ?? "").toLowerCase() === "admin";

  const configure =
    isAdmin ||
    has(
      authorities,
      "System",
      "AVCfg",
      "Network",
      "Storage",
      "Event",
      "AuthSysCfg",
      "AuthStoreCfg",
      "AuthEventCfg",
      "AuthNetCfg",
    );
  const userManagement = isAdmin || has(authorities, "UserManage", "System_Account", "AuthUserMag");

  const playbackChannels = [
    ...new Set([...channelsFor(authorities, "Playback"), ...channelsFor(authorities, "Replay")]),
  ].sort((a, b) => a - b);

  return {
    available: true,
    username: user.name,
    group: user.group,
    memo: user.memo,
    isAdmin,
    authorities,
    capabilities: {
      liveView: isAdmin || hasPrefix(authorities, "Monitor") || has(authorities, "Monitor"),
      playback:
        isAdmin ||
        hasPrefix(authorities, "Playback") ||
        hasPrefix(authorities, "Replay") ||
        has(authorities, "Playback", "Replay"),
      ptz: isAdmin || hasPrefix(authorities, "PTZ") || has(authorities, "PTZ", "AuthPTZ"),
      record:
        isAdmin ||
        hasPrefix(authorities, "Record") ||
        has(authorities, "Record", "AuthManuCtr"),
      backup: isAdmin || has(authorities, "Backup", "AuthBackup"),
      configure,
      userManagement,
      reboot: isAdmin || has(authorities, "ShutDown", "System", "AuthMaintence", "AuthMaintenance"),
    },
    channels: {
      liveView: channelsFor(authorities, "Monitor"),
      playback: playbackChannels,
      ptz: channelsFor(authorities, "PTZ"),
    },
  };
}

/**
 * Droits effectifs du compte utilisé pour se connecter.
 *
 * Un compte non-administrateur n'a en général pas le droit de lister les
 * utilisateurs : on renvoie alors un résumé « indisponible » plutôt qu'une
 * erreur, la connexion elle-même restant valide.
 */
export async function getRightsForAccount(target: DahuaTarget): Promise<RightsSummary> {
  const fallback: RightsSummary = {
    available: false,
    username: target.username,
    isAdmin: false,
    authorities: [],
    capabilities: {
      liveView: false,
      playback: false,
      ptz: false,
      record: false,
      backup: false,
      configure: false,
      userManagement: false,
      reboot: false,
    },
    channels: { liveView: [], playback: [], ptz: [] },
  };

  let users: DeviceUser[];
  try {
    users = await getUsers(target);
  } catch (error) {
    if (error instanceof DahuaError && (error.reason === "forbidden" || error.reason === "http")) {
      return {
        ...fallback,
        unavailableReason:
          "Ce compte n'a pas le droit de lister les utilisateurs de l'enregistreur — droits non administrateur.",
      };
    }
    throw error;
  }

  const match = users.find((user) => user.name.toLowerCase() === target.username.toLowerCase());
  if (!match) {
    return {
      ...fallback,
      unavailableReason:
        "Compte introuvable dans la liste des utilisateurs de l'enregistreur (authentification par annuaire ?).",
    };
  }

  return summarizeRights(match);
}

/** Titres des canaux, pour afficher un nom de caméra lisible sur les alarmes. */
export async function getChannelTitles(target: DahuaTarget): Promise<Record<number, string>> {
  const parsed = await get(
    target,
    "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle",
  );
  const table = parsed.table as DahuaObject | undefined;
  const list = table?.ChannelTitle;
  if (!Array.isArray(list)) return {};

  const titles: Record<number, string> = {};
  list.forEach((entry, index) => {
    if (typeof entry === "object" && !Array.isArray(entry)) {
      const name = entry.Name;
      if (typeof name === "string" && name.length > 0) titles[index + 1] = name;
    }
  });
  return titles;
}

export type StorageDevice = {
  name: string;
  /** État brut remonté par le firmware (`Success`, `Error`, `Nonexist`…). */
  state?: string;
  /** Faux si le disque est en erreur ou si une de ses partitions l'est. */
  healthy: boolean;
  totalBytes?: number;
  usedBytes?: number;
  partitions: number;
};

function isObject(value: DahuaValue | undefined): value is DahuaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objects(value: DahuaValue | undefined): DahuaObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * Les firmwares expriment les capacités en octets (`TotalBytes=1000204886016.00`),
 * certains anciens en Mo. Aucun disque d'enregistreur ne fait moins de 100 Mo :
 * une valeur plus petite ne peut être que des Mo.
 */
function toBytes(value: DahuaValue | undefined): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n >= 1e8 ? n : n * 1024 * 1024;
}

/** État des disques — un disque plein ou absent est une cause d'alarme fréquente. */
export async function getStorage(target: DahuaTarget): Promise<StorageDevice[]> {
  return parseStorage(await get(target, "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo"));
}

/** Interprète la réponse de `storageDevice.cgi?action=getDeviceAllInfo`. */
export function parseStorage(parsed: DahuaObject): StorageDevice[] {
  // Réponse usuelle : `list.info[0].Name=/dev/sda`, `list.info[0].Detail[0].TotalBytes=…`
  // — `list` est donc un objet portant le tableau `info`. Certains firmwares
  // renvoient directement `list[0]…` ou `info[0]…`.
  const entries = Array.isArray(parsed.list)
    ? objects(parsed.list)
    : isObject(parsed.list)
      ? objects(parsed.list.info)
      : objects(parsed.info);

  return entries.map((entry) => {
    const details = objects(entry.Detail);
    const sum = (key: "TotalBytes" | "UsedBytes"): number | undefined => {
      const values = (details.length ? details.map((d) => d[key]) : [entry[key]])
        .map(toBytes)
        .filter((n): n is number => n !== undefined);
      return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
    };

    const state = entry.State !== undefined ? String(entry.State) : undefined;
    const partitionError = details.some((d) => d.IsError === true);
    const stateOk = state === undefined || /^(success|normal|ok)$/i.test(state);

    return {
      name: String(entry.Name ?? details[0]?.Path ?? "disque"),
      state,
      healthy: stateOk && !partitionError,
      totalBytes: sum("TotalBytes"),
      usedBytes: sum("UsedBytes"),
      partitions: details.length,
    };
  });
}

/** Canaux actuellement en alarme pour un code donné (VideoMotion, VideoLoss…). */
export async function getEventIndexes(target: DahuaTarget, code: string): Promise<number[]> {
  const parsed = await get(
    target,
    `/cgi-bin/eventManager.cgi?action=getEventIndexes&code=${encodeURIComponent(code)}`,
  );
  const list = parsed.channels;
  if (!Array.isArray(list)) return [];
  return list.map(Number).filter((n) => Number.isFinite(n));
}

/** Redémarrage de l'enregistreur — action sensible, systématiquement auditée. */
export async function reboot(target: DahuaTarget): Promise<void> {
  await dahuaRequestText(target, "/cgi-bin/magicBox.cgi?action=reboot");
}

/** Remet l'équipement à l'heure (dérive d'horloge = horodatages d'alarme faux). */
/**
 * Fuseau horaire des enregistreurs du parc. Un NVR attend son heure LOCALE
 * (heure murale) : on la calcule explicitement dans ce fuseau, changements
 * d'heure été/hiver compris, sans dépendre du fuseau du serveur (souvent UTC
 * dans un conteneur — d'où un décalage de 1 à 2 h auparavant).
 */
export const DEVICE_TIME_ZONE = process.env.DAHUA_TIME_ZONE?.trim() || "Europe/Paris";

/** Heure murale `AAAA-MM-JJ HH:MM:SS` de `date` dans le fuseau donné. */
export function formatDeviceTime(date: Date, timeZone = DEVICE_TIME_ZONE): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new DahuaError("invalid", `Fuseau horaire inconnu : ${timeZone} (DAHUA_TIME_ZONE)`);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return (
    `${part("year")}-${part("month")}-${part("day")} ` +
    `${part("hour")}:${part("minute")}:${part("second")}`
  );
}

export async function setDeviceTime(target: DahuaTarget, date = new Date()): Promise<string> {
  const formatted = formatDeviceTime(date);
  await dahuaRequestText(
    target,
    `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(formatted)}`,
  );
  return formatted;
}

/** Capture instantanée d'un canal, renvoyée en JPEG brut. */
export async function snapshot(target: DahuaTarget, channel = 1): Promise<Buffer> {
  const res = await dahuaRequest(target, `/cgi-bin/snapshot.cgi?channel=${channel}`);
  if (res.body.length === 0) {
    throw new DahuaError("http", "L'enregistreur a renvoyé une image vide");
  }
  return res.body;
}

/** État des sorties relais (contacts secs). */
export async function getAlarmOutState(target: DahuaTarget): Promise<boolean[]> {
  const parsed = await get(target, "/cgi-bin/alarm.cgi?action=getOutState");
  const info = parsed.info as DahuaObject | undefined;
  const states = info?.states ?? parsed.states;
  if (!Array.isArray(states)) return [];
  return states.map((state) => state === 1 || state === true);
}

/**
 * Pilote une sortie relais : `1` force la sortie, `0` la relâche.
 * Sert à déclencher une sirène ou un renvoi vers un système tiers.
 */
export async function setAlarmOut(
  target: DahuaTarget,
  index: number,
  active: boolean,
): Promise<void> {
  await dahuaRequestText(
    target,
    `/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${index}].Mode=${active ? 1 : 0}`,
  );
}

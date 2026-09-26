import { DahuaError, dahuaRequestText, type DahuaTarget } from "./http";
import { parseKeyValue, type DahuaObject, type DahuaValue } from "./parse";
import { withRpc, type RpcSession } from "./rpc";
import { formatDeviceTime, getChannelTitles, getDeviceInfo, getEventIndexes } from "./client";

/**
 * Maintenance à distance : ce qu'un technicien regarde sur place, sans y aller.
 *
 * Les firmwares Dahua varient beaucoup d'un modèle à l'autre. Règle suivie
 * ici : ce qui est documenté est affiché proprement ; le reste est découvert
 * sur l'équipement lui-même (`system.listMethod`, sections de configuration
 * présentes) et remonté tel quel, sans rien deviner. Chaque bloc échoue
 * isolément : une information indisponible n'empêche pas les autres.
 */

export type Failure = { error: string };

export async function attempt<T>(run: () => Promise<T>): Promise<T | Failure> {
  try {
    return await run();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "error" in value && Object.keys(value).length === 1;
}

function isObject(value: DahuaValue | undefined): value is DahuaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lecture d'une section de configuration par l'API CGI (`table.<name>…`). */
export async function readConfig(target: DahuaTarget, name: string): Promise<DahuaValue | undefined> {
  const text = await dahuaRequestText(
    target,
    `/cgi-bin/configManager.cgi?action=getConfig&name=${encodeURIComponent(name)}`,
  );
  const table = parseKeyValue(text).table;
  return isObject(table) ? table[name] : undefined;
}

// ---------------------------------------------------------------------------
// Statistiques système (RPC2)
// ---------------------------------------------------------------------------

/** Méthodes de lecture dont le nom évoque débit, trafic ou PoE. */
const STAT_METHOD = /(DataStat|BitRate|Bitrate|Flow|Bandwidth|NetStat|Traffic|PoE)/i;
const READ_METHOD = /^[A-Za-z0-9_]+\.(get|list|query)[A-Za-z0-9_]*$/;

async function listMethods(rpc: RpcSession): Promise<string[]> {
  const result = await rpc.call<{ method?: unknown }>("system.listMethod");
  return Array.isArray(result?.method) ? result.method.map(String) : [];
}

export type SystemStats = {
  cpu: { usagePercent: number } | Failure;
  memory: { totalBytes: number; freeBytes: number; usedPercent: number } | Failure;
  uptime: { seconds: number; sinceBoot?: number } | Failure;
  interfaces:
    | { name: string; type?: string; connected: boolean | null; speedMbps: number | null; mac?: string }[]
    | Failure;
  /** Méthodes de statistiques propres à ce firmware, appelées telles quelles. */
  discovered: { method: string; result: unknown }[];
};

export async function getSystemStats(target: DahuaTarget): Promise<SystemStats> {
  return withRpc(target, async (rpc) => {
    const cpu = await attempt(async () => {
      const r = await rpc.call<{ usage?: number }>("magicBox.getCPUUsage", { index: 0 });
      if (typeof r?.usage !== "number") throw new Error("réponse sans « usage »");
      return { usagePercent: r.usage };
    });
    const memory = await attempt(async () => {
      const r = await rpc.call<{ total?: number; free?: number }>("magicBox.getMemoryInfo");
      const total = Number(r?.total);
      const free = Number(r?.free);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) throw new Error("réponse incomplète");
      return { totalBytes: total, freeBytes: free, usedPercent: Math.round(((total - free) / total) * 1000) / 10 };
    });
    const uptime = await attempt(async () => {
      const r = await rpc.call<{ last?: number; total?: number }>("magicBox.getUpTime");
      const seconds = Number(r?.last);
      if (!Number.isFinite(seconds)) throw new Error("réponse sans « last »");
      return { seconds, sinceBoot: Number.isFinite(Number(r?.total)) ? Number(r?.total) : undefined };
    });
    const interfaces = await attempt(async () => {
      const r = await rpc.call<{ netInterface?: Record<string, unknown>[] }>("netApp.getNetInterfaces");
      return (r?.netInterface ?? []).map((nic) => ({
        name: String(nic.Name ?? nic.NetCardName ?? "?"),
        type: nic.Type !== undefined ? String(nic.Type) : undefined,
        connected:
          nic.ConnStatus === undefined ? null : /^(connect|up|on)/i.test(String(nic.ConnStatus)),
        speedMbps: Number.isFinite(Number(nic.Speed)) ? Number(nic.Speed) : null,
        mac: nic.PhysicalAddress !== undefined ? String(nic.PhysicalAddress) : undefined,
      }));
    });

    const discovered: { method: string; result: unknown }[] = [];
    const methods = await attempt(() => listMethods(rpc));
    if (!isFailure(methods)) {
      for (const method of methods.filter((m) => STAT_METHOD.test(m) && READ_METHOD.test(m)).slice(0, 8)) {
        const result = await attempt(() => rpc.call(method));
        discovered.push({ method, result });
      }
    }

    return { cpu, memory, uptime, interfaces, discovered };
  });
}

// ---------------------------------------------------------------------------
// Caméras (voies de l'enregistreur)
// ---------------------------------------------------------------------------

type StreamConfig = {
  enabled: boolean | null;
  codec: string | null;
  resolution: string | null;
  fps: number | null;
  bitrateKbps: number | null;
  bitrateControl: string | null;
};

export type CameraInfo = {
  channel: number;
  title: string | null;
  /** Faux si l'enregistreur signale une perte vidéo sur la voie. */
  online: boolean | null;
  address: string | null;
  model: string | null;
  main: StreamConfig | null;
  sub: StreamConfig | null;
};

function streamConfig(format: DahuaValue | undefined): StreamConfig | null {
  const first = Array.isArray(format) ? format[0] : format;
  if (!isObject(first)) return null;
  const video = isObject(first.Video) ? first.Video : undefined;
  if (!video) return null;
  const width = Number(video.Width);
  const height = Number(video.Height);
  const num = (value: DahuaValue | undefined) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    enabled: typeof first.VideoEnable === "boolean" ? first.VideoEnable : null,
    codec: video.Compression !== undefined ? String(video.Compression) : null,
    resolution: Number.isFinite(width) && Number.isFinite(height) ? `${width}×${height}` : null,
    fps: num(video.FPS),
    bitrateKbps: num(video.BitRate),
    bitrateControl: video.BitRateControl !== undefined ? String(video.BitRateControl) : null,
  };
}

export async function getCameras(target: DahuaTarget) {
  const [titles, device, lost, encode, remote] = await Promise.all([
    attempt(() => getChannelTitles(target)),
    attempt(() => getDeviceInfo(target)),
    attempt(() => getEventIndexes(target, "VideoLoss")),
    attempt(() => readConfig(target, "Encode")),
    attempt(() => readConfig(target, "RemoteDevice")),
  ]);

  const titleMap = isFailure(titles) ? {} : titles;
  const encodeList = !isFailure(encode) && Array.isArray(encode) ? encode : [];

  // RemoteDevice : clés « …_INFO_<n> », n = voie - 1, sur les NVR Dahua.
  const remoteByChannel = new Map<number, DahuaObject>();
  if (!isFailure(remote) && isObject(remote)) {
    for (const [key, value] of Object.entries(remote)) {
      const match = /_(\d+)$/.exec(key);
      if (match && isObject(value)) remoteByChannel.set(Number(match[1]) + 1, value);
    }
  }

  const count = Math.max(
    !isFailure(device) && device.videoInputChannels ? device.videoInputChannels : 0,
    encodeList.length,
    ...Object.keys(titleMap).map(Number),
    ...remoteByChannel.keys(),
    0,
  );
  // Voies en perte vidéo (indices 0-based côté équipement).
  const offline = isFailure(lost) ? null : new Set(lost.map((index) => index + 1));

  const cameras: CameraInfo[] = [];
  for (let channel = 1; channel <= count; channel++) {
    const enc = encodeList[channel - 1];
    const rd = remoteByChannel.get(channel);
    cameras.push({
      channel,
      title: (titleMap as Record<number, string>)[channel] ?? null,
      online: offline ? !offline.has(channel) : null,
      address: rd?.Address !== undefined ? String(rd.Address) : null,
      model: rd?.DeviceType !== undefined ? String(rd.DeviceType) : null,
      main: isObject(enc) ? streamConfig(enc.MainFormat) : null,
      sub: isObject(enc) ? streamConfig(enc.ExtraFormat) : null,
    });
  }

  const known = cameras.filter((camera) => camera.online !== null);
  return {
    summary: {
      channels: cameras.length,
      online: known.filter((c) => c.online).length,
      offline: known.filter((c) => !c.online).length,
      // Débit maximal configuré (somme des flux principaux + secondaires actifs).
      configuredKbps: cameras.reduce(
        (sum, c) => sum + (c.main?.bitrateKbps ?? 0) + (c.sub && c.sub.enabled !== false ? (c.sub.bitrateKbps ?? 0) : 0),
        0,
      ),
    },
    cameras,
    unavailable: {
      ...(isFailure(titles) ? { titles: titles.error } : {}),
      ...(isFailure(lost) ? { videoLoss: lost.error } : {}),
      ...(isFailure(encode) ? { encode: encode.error } : {}),
      ...(isFailure(remote) ? { remoteDevices: remote.error } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// PoE
// ---------------------------------------------------------------------------

export type PoePort = { port: number; enabled: boolean | null; fields: Record<string, DahuaValue> };

/** Clé booléenne qui pilote l'alimentation d'un port, selon le firmware. */
function powerKey(fields: Record<string, DahuaValue>): string | undefined {
  if (typeof fields.Enable === "boolean") return "Enable";
  return Object.keys(fields).find((key) => /enable|power/i.test(key) && typeof fields[key] === "boolean");
}

export async function getPoeStatus(target: DahuaTarget) {
  const config = await attempt(() => readConfig(target, "PoE"));
  const ports: PoePort[] = [];
  if (!isFailure(config) && Array.isArray(config)) {
    config.forEach((entry, index) => {
      if (!isObject(entry)) return;
      const key = powerKey(entry);
      ports.push({ port: index + 1, enabled: key ? (entry[key] as boolean) : null, fields: entry });
    });
  }

  // Méthodes RPC propres au PoE (état, consommation…), appelées telles quelles.
  const discovered = await attempt(() =>
    withRpc(target, async (rpc) => {
      const methods = (await listMethods(rpc)).filter((m) => /poe/i.test(m));
      const results: { method: string; result: unknown }[] = [];
      for (const method of methods.filter((m) => READ_METHOD.test(m)).slice(0, 6)) {
        results.push({ method, result: await attempt(() => rpc.call(method)) });
      }
      return { methods, results };
    }),
  );

  return {
    controllable: ports.some((port) => port.enabled !== null),
    ports,
    configError: isFailure(config) ? config.error : !Array.isArray(config) ? "section « PoE » absente" : null,
    rpc: discovered,
  };
}

/**
 * Coupe, rétablit ou redémarre (coupure puis rétablissement) l'alimentation
 * d'un port PoE — le moyen le plus sûr de relancer une caméra figée. Écrit la
 * seule clé d'alimentation du port, puis relit pour confirmer.
 */
export async function setPoePower(
  target: DahuaTarget,
  options: { port: number; mode: "on" | "off" | "cycle"; dryRun?: boolean; offSeconds?: number },
) {
  const config = await readConfig(target, "PoE");
  if (!Array.isArray(config) || config.length === 0) {
    throw new DahuaError(
      "unsupported",
      "Pilotage PoE non exposé par ce firmware (section de configuration « PoE » absente) — voir « Capacités » pour les méthodes disponibles",
    );
  }
  const index = options.port - 1;
  const entry = config[index];
  if (!isObject(entry)) {
    throw new DahuaError("invalid", `Port PoE ${options.port} inexistant (ports 1 à ${config.length})`);
  }
  const key = powerKey(entry);
  if (!key) {
    throw new DahuaError("unsupported", `Aucune clé d'alimentation reconnue sur le port ${options.port}`);
  }

  const write = async (on: boolean) =>
    dahuaRequestText(target, `/cgi-bin/configManager.cgi?action=setConfig&PoE[${index}].${key}=${on}`);
  const previous = entry[key] as boolean;

  if (options.dryRun) {
    return {
      port: options.port,
      mode: options.mode,
      dryRun: true,
      key: `PoE[${index}].${key}`,
      current: previous,
      wouldWrite: options.mode === "cycle" ? [false, true] : [options.mode === "on"],
    };
  }

  if (options.mode === "cycle") {
    const offSeconds = Math.min(Math.max(options.offSeconds ?? 10, 3), 60);
    await write(false);
    await new Promise((resolve) => setTimeout(resolve, offSeconds * 1000));
    await write(true);
  } else {
    await write(options.mode === "on");
  }

  const after = await readConfig(target, "PoE");
  const now = Array.isArray(after) && isObject(after[index]) ? (after[index] as DahuaObject)[key] : undefined;
  const expected = options.mode !== "off";
  return {
    port: options.port,
    mode: options.mode,
    previous,
    current: typeof now === "boolean" ? now : null,
    confirmed: now === expected,
  };
}

// ---------------------------------------------------------------------------
// Journal de l'enregistreur (log.cgi)
// ---------------------------------------------------------------------------

export async function getLogs(target: DahuaTarget, options: { hours?: number; limit?: number } = {}) {
  const hours = Math.min(Math.max(options.hours ?? 24, 1), 24 * 30);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  const q = (value: string) => encodeURIComponent(value);

  const started = parseKeyValue(
    await dahuaRequestText(
      target,
      `/cgi-bin/log.cgi?action=startFind&condition.StartTime=${q(formatDeviceTime(start))}&condition.EndTime=${q(formatDeviceTime(end))}`,
    ),
  );
  const token = started.token;
  if (token === undefined) throw new DahuaError("unsupported", "Recherche dans le journal refusée par l'équipement");

  try {
    const found = parseKeyValue(
      await dahuaRequestText(target, `/cgi-bin/log.cgi?action=doFind&token=${q(String(token))}&count=${limit}`),
    );
    const items = Array.isArray(found.items) ? found.items : [];
    const flatten = (value: DahuaValue | undefined): string =>
      value === undefined
        ? ""
        : isObject(value)
          ? Object.entries(value)
              .map(([k, v]) => `${k}: ${flatten(v)}`)
              .join(", ")
          : Array.isArray(value)
            ? value.map(flatten).join(", ")
            : String(value);
    return {
      from: formatDeviceTime(start),
      to: formatDeviceTime(end),
      total: Number(found.found ?? items.length),
      entries: items.filter(isObject).map((item) => ({
        time: item.Time !== undefined ? String(item.Time) : null,
        type: item.Type !== undefined ? String(item.Type) : null,
        user: item.User !== undefined ? String(item.User) : null,
        detail: flatten(item.Detail) || null,
      })),
    };
  } finally {
    await dahuaRequestText(target, `/cgi-bin/log.cgi?action=stopFind&token=${q(String(token))}`).catch(() => "");
  }
}

// ---------------------------------------------------------------------------
// Capacités (diagnostic d'adaptation au firmware)
// ---------------------------------------------------------------------------

const PROBED_SECTIONS = ["PoE", "Encode", "RemoteDevice", "ChannelTitle", "NTP", "Locales", "RecordMode"];
const METHOD_GROUPS: Record<string, RegExp> = {
  poe: /poe/i,
  reseau: /(net|flow|bitrate|bandwidth|traffic)/i,
  systeme: /^(magicBox|system)\./i,
  stockage: /(storage|disk|hdd)/i,
  cameras: /(remote|logicdevice|devvideo|channel)/i,
  journal: /^log\./i,
};

export async function getCapabilities(target: DahuaTarget) {
  const rpc = await attempt(() =>
    withRpc(target, async (session) => {
      const methods = await listMethods(session);
      const groups = Object.fromEntries(
        Object.entries(METHOD_GROUPS).map(([group, re]) => [group, methods.filter((m) => re.test(m))]),
      );
      return { available: true, methodCount: methods.length, groups };
    }),
  );
  const sections: Record<string, boolean | string> = {};
  for (const name of PROBED_SECTIONS) {
    const value = await attempt(() => readConfig(target, name));
    sections[name] = isFailure(value) ? value.error : value !== undefined;
  }
  return { rpc: isFailure(rpc) ? { available: false, error: rpc.error } : rpc, configSections: sections };
}

// ---------------------------------------------------------------------------
// Lecture avancée (RPC2, lecture seule)
// ---------------------------------------------------------------------------

/** Seules les méthodes de lecture sont autorisées : get*, list*, query*, configManager.getConfig. */
export function isReadOnlyMethod(method: string): boolean {
  return READ_METHOD.test(method) || method === "configManager.getConfig" || method === "system.listMethod";
}

export async function advancedRead(target: DahuaTarget, method: string, params: unknown) {
  if (!isReadOnlyMethod(method)) {
    throw new DahuaError("invalid", "Seules les méthodes de lecture (get…, list…, query…) sont autorisées ici");
  }
  return withRpc(target, async (rpc) => ({ method, response: await rpc.raw(method, params ?? null) }));
}

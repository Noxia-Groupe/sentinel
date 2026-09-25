import { Badge } from "@/components/ui/badge";

/**
 * Mise en forme lisible du résultat d'une intervention à distance.
 *
 * Chaque action connue a son rendu ; les autres (et le JSON complet, utile au
 * diagnostic) restent consultables dans le bloc « Données brutes ».
 */

const CAPABILITY_LABELS: Record<string, string> = {
  liveView: "Temps réel",
  playback: "Relecture",
  ptz: "PTZ",
  record: "Enregistrement",
  backup: "Export",
  configure: "Configuration",
  userManagement: "Gestion des comptes",
  reboot: "Redémarrage",
};

type UserRow = {
  name: string;
  group?: string;
  memo?: string;
  reserved?: boolean;
  authorities: string[];
  summary?: {
    isAdmin: boolean;
    capabilities: Record<string, boolean>;
    channels: { liveView: number[]; playback: number[]; ptz: number[] };
  };
};

type StorageRow = {
  name: string;
  state?: string;
  healthy?: boolean;
  totalBytes?: number;
  usedBytes?: number;
  partitions?: number;
};

const DEVICE_LABELS: Record<string, string> = {
  deviceType: "Modèle",
  serialNumber: "N° de série",
  machineName: "Nom",
  softwareVersion: "Firmware",
  buildDate: "Date du firmware",
  hardwareVersion: "Version matérielle",
  processor: "Processeur",
  deviceTime: "Heure de l'enregistreur",
  videoInputChannels: "Canaux vidéo",
};

export function ActionResult({ action, data }: { action: string; data: unknown }) {
  return (
    <div className="space-y-4">
      <Formatted action={action} data={data} />
      <details className="group">
        <summary className="cursor-pointer text-xs text-[#8896b4] hover:text-[#dde1e4]">
          Données brutes
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-[#080d24] border border-[#132255] p-3 text-[11px] text-[#8896b4]">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Formatted({ action, data }: { action: string; data: unknown }) {
  switch (action) {
    case "users":
      return Array.isArray(data) ? <UsersResult users={data as UserRow[]} /> : null;
    case "storage":
      return Array.isArray(data) ? <StorageResult disks={data as StorageRow[]} /> : null;
    case "device-info":
      return isRecord(data) ? <DeviceInfoResult info={data} /> : null;
    case "channels":
      return isRecord(data) ? <ChannelsResult titles={data} /> : null;
    case "alarm-out-state":
      return isRecord(data) && Array.isArray(data.states) ? (
        <AlarmOutResult states={data.states as boolean[]} />
      ) : null;
    case "sync-time":
      return isRecord(data) ? (
        <p className="text-sm text-[#dde1e4]">
          Heure appliquée à l&apos;enregistreur :{" "}
          <span className="font-mono">{String(data.time ?? "—")}</span>
          {data.timeZone ? (
            <span className="text-[#8896b4]"> ({String(data.timeZone)}, heure légale)</span>
          ) : null}
        </p>
      ) : null;
    case "event-indexes":
      return isRecord(data) ? (
        <p className="text-sm text-[#dde1e4]">
          {Array.isArray(data.channels) && data.channels.length > 0
            ? `Canaux en alarme (${String(data.code)}) : ${formatChannels(data.channels as number[])}`
            : `Aucun canal en alarme pour ${String(data.code)}.`}
        </p>
      ) : null;
    default:
      return null;
  }
}

function UsersResult({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return <Empty>Aucun compte remonté par l&apos;enregistreur.</Empty>;
  }
  return (
    <div className="space-y-3">
      {users.map((user) => {
        const voice = channelsFrom(user.authorities, "Voice");
        return (
          <div key={user.name} className="rounded-lg border border-[#132255] bg-[#080d24] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#dde1e4]">{user.name}</span>
              {user.summary?.isAdmin ? (
                <Badge className="bg-red-500/10 text-red-400 border-red-500/25">administrateur</Badge>
              ) : user.group ? (
                <Badge className="bg-[#132255] text-[#dde1e4] border-[#1a2d66]">
                  groupe {user.group}
                </Badge>
              ) : null}
              {user.reserved && (
                <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">compte système</Badge>
              )}
            </div>

            {user.summary && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(user.summary.capabilities).map(([capability, granted]) => (
                  <span
                    key={capability}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                      granted
                        ? "border-green-500/25 bg-green-500/10 text-green-400"
                        : "border-[#132255] bg-[#0a1130] text-[#8896b4]/60 line-through"
                    }`}
                  >
                    {CAPABILITY_LABELS[capability] ?? capability}
                  </span>
                ))}
              </div>
            )}

            {user.summary && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
                <dt className="text-[#8896b4]">Temps réel</dt>
                <dd className="text-[#dde1e4]">{formatChannels(user.summary.channels.liveView)}</dd>
                <dt className="text-[#8896b4]">Relecture</dt>
                <dd className="text-[#dde1e4]">{formatChannels(user.summary.channels.playback)}</dd>
                {voice.length > 0 && (
                  <>
                    <dt className="text-[#8896b4]">Audio bidirectionnel</dt>
                    <dd className="text-[#dde1e4]">{formatChannels(voice)}</dd>
                  </>
                )}
                {user.summary.channels.ptz.length > 0 && (
                  <>
                    <dt className="text-[#8896b4]">PTZ</dt>
                    <dd className="text-[#dde1e4]">{formatChannels(user.summary.channels.ptz)}</dd>
                  </>
                )}
              </dl>
            )}

            {user.memo && <p className="text-[11px] text-[#8896b4]">{user.memo}</p>}

            <details>
              <summary className="cursor-pointer text-[11px] text-[#8896b4] hover:text-[#dde1e4]">
                Droits détaillés ({user.authorities.length})
              </summary>
              <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[#8896b4] break-words">
                {user.authorities.join(" · ")}
              </p>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function StorageResult({ disks }: { disks: StorageRow[] }) {
  if (disks.length === 0) {
    return (
      <Empty>
        Aucun disque détecté par l&apos;enregistreur — vérifier la présence et le raccordement du
        disque dur.
      </Empty>
    );
  }
  return (
    <div className="space-y-3">
      {disks.map((disk) => {
        const ratio =
          disk.totalBytes && disk.usedBytes !== undefined ? disk.usedBytes / disk.totalBytes : undefined;
        const percent = ratio !== undefined ? Math.round(ratio * 100) : undefined;
        const barColor =
          ratio === undefined ? "bg-[#132255]" : ratio >= 0.98 ? "bg-amber-400" : "bg-green-400";
        return (
          <div key={disk.name} className="rounded-lg border border-[#132255] bg-[#080d24] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-[#dde1e4]">{disk.name}</span>
              {disk.healthy === false ? (
                <Badge className="bg-red-500/10 text-red-400 border-red-500/25">
                  en erreur{disk.state ? ` (${disk.state})` : ""}
                </Badge>
              ) : (
                <Badge className="bg-green-500/10 text-green-400 border-green-500/25">opérationnel</Badge>
              )}
            </div>
            {percent !== undefined && (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#132255]">
                  <div className={`h-full ${barColor}`} style={{ width: `${Math.min(percent, 100)}%` }} />
                </div>
                <p className="text-xs text-[#8896b4]">
                  {formatBytes(disk.usedBytes)} utilisés sur {formatBytes(disk.totalBytes)} ({percent} %)
                  {ratio !== undefined && ratio >= 0.98
                    ? " — disque plein : normal si l'écrasement automatique est activé"
                    : ""}
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeviceInfoResult({ info }: { info: Record<string, unknown> }) {
  const rows = Object.entries(DEVICE_LABELS).filter(
    ([key]) => info[key] !== undefined && info[key] !== null && info[key] !== "",
  );
  if (rows.length === 0) return <Empty>Aucune information remontée.</Empty>;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
      {rows.map(([key, label]) => (
        <div key={key}>
          <dt className="text-xs text-[#8896b4]">{label}</dt>
          <dd className="text-sm text-[#dde1e4] font-mono break-words">{String(info[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChannelsResult({ titles }: { titles: Record<string, unknown> }) {
  const entries = Object.entries(titles).sort(([a], [b]) => Number(a) - Number(b));
  if (entries.length === 0) return <Empty>Aucun titre de canal configuré.</Empty>;
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {entries.map(([channel, name]) => (
        <li key={channel} className="text-sm">
          <span className="text-[#8896b4]">Canal {channel} — </span>
          <span className="text-[#dde1e4]">{String(name)}</span>
        </li>
      ))}
    </ul>
  );
}

function AlarmOutResult({ states }: { states: boolean[] }) {
  if (states.length === 0) return <Empty>Aucune sortie d&apos;alarme.</Empty>;
  return (
    <ul className="flex flex-wrap gap-2">
      {states.map((active, index) => (
        <li
          key={index}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${
            active
              ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
              : "border-[#132255] bg-[#080d24] text-[#8896b4]"
          }`}
        >
          Sortie {index + 1} : {active ? "active" : "repos"}
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#8896b4]">{children}</p>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canaux portés par des autorités du type `Voice_03`. */
function channelsFrom(authorities: string[], prefix: string): number[] {
  const re = new RegExp(`^${prefix}_(\\d+)$`, "i");
  const channels = authorities
    .map((a) => re.exec(a)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return [...new Set(channels)].sort((a, b) => a - b);
}

/** `[1,2,3,5,7,8]` → « 1 à 3, 5, 7, 8 » ; liste vide → « aucun ». */
export function formatChannels(channels: number[]): string {
  if (channels.length === 0) return "aucun";
  const sorted = [...new Set(channels)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of [...sorted.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    if (start === prev) ranges.push(String(start));
    else if (prev === start + 1) ranges.push(String(start), String(prev));
    else ranges.push(`${start} à ${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}

/** Octets → « 3,6 To », « 931 Go »… (unités décimales, comme les fabricants de disques). */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

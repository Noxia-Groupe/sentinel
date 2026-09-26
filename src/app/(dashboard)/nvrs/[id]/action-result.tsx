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

type OnAction = (action: string, params: Record<string, unknown>) => void;

export function ActionResult({
  action,
  data,
  onAction,
  busy,
}: {
  action: string;
  data: unknown;
  /** Relance une action depuis le résultat (ex. pilotage d'un port PoE). */
  onAction?: OnAction;
  busy?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Formatted action={action} data={data} onAction={onAction} busy={busy} />
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

function Formatted({
  action,
  data,
  onAction,
  busy,
}: {
  action: string;
  data: unknown;
  onAction?: OnAction;
  busy?: boolean;
}) {
  switch (action) {
    case "maintenance-report":
      return isRecord(data) ? <MaintenanceReportResult report={data} onAction={onAction} busy={busy} /> : null;
    case "system-stats":
      return isRecord(data) ? <SystemStatsResult stats={data} /> : null;
    case "cameras":
      return isRecord(data) ? <CamerasResult result={data} /> : null;
    case "poe-status":
      return isRecord(data) ? <PoeResult result={data} onAction={onAction} busy={busy} /> : null;
    case "poe-power":
      return isRecord(data) ? <PoePowerResult result={data} onAction={onAction} busy={busy} /> : null;
    case "logs":
      return isRecord(data) ? <LogsResult result={data} /> : null;
    case "capabilities":
      return isRecord(data) ? <CapabilitiesResult result={data} /> : null;
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

// ---------------------------------------------------------------------------
// Maintenance : charge système, caméras, PoE, journal, capacités
// ---------------------------------------------------------------------------

type Failure = { error: string };
const failed = (value: unknown): value is Failure =>
  isRecord(value) && typeof value.error === "string" && Object.keys(value).length === 1;

function Unavailable({ what, reason }: { what: string; reason: string }) {
  return (
    <p className="text-xs text-[#8896b4]">
      {what} : <span className="text-amber-300/80">indisponible</span> — {reason}
    </p>
  );
}

function Gauge({ label, percent, detail }: { label: string; percent: number; detail?: string }) {
  const color = percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-400" : "bg-green-500";
  return (
    <div className="rounded-lg border border-[#132255] bg-[#080d24] p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-[#8896b4]">{label}</span>
        <span className="text-lg font-semibold text-[#dde1e4]">{percent.toLocaleString("fr-FR")} %</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#132255]">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
      </div>
      {detail && <p className="text-[11px] text-[#8896b4]">{detail}</p>}
    </div>
  );
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

// ---------------------------------------------------------------------------
// Bilan de maintenance
// ---------------------------------------------------------------------------

type Finding = {
  level: "critical" | "warning" | "info";
  domain: string;
  message: string;
  recommendation?: string;
  action?: { name: string; params?: Record<string, unknown> };
};

const LEVEL_STYLE: Record<Finding["level"], { label: string; badge: string; border: string }> = {
  critical: { label: "Critique", badge: "bg-red-500/10 text-red-400 border-red-500/25", border: "border-red-500/30" },
  warning: { label: "À surveiller", badge: "bg-amber-400/10 text-amber-300 border-amber-400/25", border: "border-amber-400/25" },
  info: { label: "Info", badge: "bg-[#132255] text-[#8896b4] border-[#1a2d66]", border: "border-[#132255]" },
};

const ACTION_LABELS: Record<string, string> = {
  "sync-time": "Remettre à l'heure",
  logs: "Voir le journal",
};

function findingActionLabel(action: NonNullable<Finding["action"]>): string {
  if (action.name === "poe-power") {
    return action.params?.mode === "on" ? "Rétablir le port PoE" : "Relancer la caméra (PoE)";
  }
  return ACTION_LABELS[action.name] ?? action.name;
}

/** Actions qui modifient l'équipement : confirmation explicite avant lancement. */
function confirmFindingAction(finding: Finding): boolean {
  const action = finding.action;
  if (!action) return false;
  if (action.name === "logs") return true;
  if (action.name === "poe-power") {
    const port = String(action.params?.port ?? "?");
    return window.confirm(
      action.params?.mode === "cycle"
        ? `Redémarrer l'alimentation du port PoE ${port} (coupure de 10 s) ? Vérifiez que la caméra concernée y est bien branchée.`
        : `Rétablir l'alimentation du port PoE ${port} ?`,
    );
  }
  return window.confirm(`${findingActionLabel(action)} ?`);
}

function MaintenanceReportResult({
  report,
  onAction,
  busy,
}: {
  report: Record<string, unknown>;
  onAction?: OnAction;
  busy?: boolean;
}) {
  const findings = (report.findings ?? []) as Finding[];
  const status = report.status as "ok" | Finding["level"];
  const system = report.system as { cpuPercent: number | null; memoryPercent: number | null; uptimeSeconds: number | null } | null;
  const cameras = report.cameras as { channels: number; online: number; offline: number; configuredKbps: number } | null;
  const disks = report.disks as { name: string; healthy: boolean; usedPercent: number | null }[] | null;
  const device = report.device as { firmware: string | null; clockDriftSeconds: number | null } | null;

  const tiles: { label: string; value: string }[] = [
    {
      label: "Disques",
      value: disks ? (disks.length === 0 ? "aucun" : `${disks.filter((d) => d.healthy).length}/${disks.length} sains`) : "—",
    },
    { label: "Caméras", value: cameras ? `${cameras.online}/${cameras.channels} en ligne` : "—" },
    { label: "Processeur", value: system?.cpuPercent != null ? `${system.cpuPercent} %` : "—" },
    { label: "Mémoire", value: system?.memoryPercent != null ? `${system.memoryPercent} %` : "—" },
    { label: "En marche depuis", value: system?.uptimeSeconds != null ? formatDuration(system.uptimeSeconds) : "—" },
    {
      label: "Écart d'horloge",
      value: device?.clockDriftSeconds != null ? `${Math.round(device.clockDriftSeconds / 60)} min` : "—",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {status === "ok" ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/25">Aucune anomalie</Badge>
        ) : (
          <Badge className={LEVEL_STYLE[status].badge}>{LEVEL_STYLE[status].label}</Badge>
        )}
        <span className="text-xs text-[#8896b4]">
          {findings.filter((f) => f.level !== "info").length} point(s) d&apos;attention,{" "}
          {findings.filter((f) => f.level === "info").length} information(s)
        </span>
      </div>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-[#132255] bg-[#080d24] p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[#8896b4]">{tile.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-[#dde1e4]">{tile.value}</p>
          </div>
        ))}
      </div>

      {findings.length > 0 && (
        <ul className="space-y-2">
          {findings.map((finding, index) => (
            <li
              key={index}
              className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-[#080d24] px-3 py-2 ${LEVEL_STYLE[finding.level].border}`}
            >
              <div className="space-y-0.5 min-w-0 flex-1">
                <p className="text-sm text-[#dde1e4] flex items-center gap-2">
                  <Badge className={LEVEL_STYLE[finding.level].badge}>{LEVEL_STYLE[finding.level].label}</Badge>
                  {finding.message}
                </p>
                {finding.recommendation && <p className="text-xs text-[#8896b4]">→ {finding.recommendation}</p>}
              </div>
              {onAction && finding.action && (
                <PoeButton
                  disabled={busy}
                  onClick={() => {
                    if (confirmFindingAction(finding)) onAction(finding.action!.name, finding.action!.params ?? {});
                  }}
                >
                  {findingActionLabel(finding.action)}
                </PoeButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {cameras && cameras.configuredKbps > 0 && (
        <p className="text-[11px] text-[#8896b4]">
          Débit maximal configuré, toutes caméras : {(cameras.configuredKbps / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mbit/s
        </p>
      )}
    </div>
  );
}

function DiscoveredBlock({ items }: { items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-[#8896b4] hover:text-[#dde1e4]">
        Statistiques propres au firmware ({items.length} méthode{items.length > 1 ? "s" : ""})
      </summary>
      <div className="mt-2 space-y-2">
        {(items as { method: string; result: unknown }[]).map((item) => (
          <div key={item.method} className="rounded-lg border border-[#132255] bg-[#080d24] p-2">
            <p className="font-mono text-[11px] text-[#4d9fe8]">{item.method}</p>
            <pre className="mt-1 max-h-48 overflow-auto text-[10px] text-[#8896b4]">
              {JSON.stringify(item.result, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function SystemStatsResult({ stats }: { stats: Record<string, unknown> }) {
  const cpu = stats.cpu as { usagePercent: number } | Failure;
  const memory = stats.memory as { totalBytes: number; freeBytes: number; usedPercent: number } | Failure;
  const uptime = stats.uptime as { seconds: number } | Failure;
  const interfaces = stats.interfaces as
    | { name: string; type?: string; connected: boolean | null; speedMbps: number | null; mac?: string }[]
    | Failure;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {failed(cpu) ? (
          <Unavailable what="Processeur" reason={cpu.error} />
        ) : (
          <Gauge label="Processeur" percent={cpu.usagePercent} />
        )}
        {failed(memory) ? (
          <Unavailable what="Mémoire" reason={memory.error} />
        ) : (
          <Gauge
            label="Mémoire"
            percent={memory.usedPercent}
            detail={`${formatBytes(memory.totalBytes - memory.freeBytes)} utilisés sur ${formatBytes(memory.totalBytes)}`}
          />
        )}
        {failed(uptime) ? (
          <Unavailable what="Fonctionnement" reason={uptime.error} />
        ) : (
          <div className="rounded-lg border border-[#132255] bg-[#080d24] p-3">
            <span className="text-xs uppercase tracking-wider text-[#8896b4]">En marche depuis</span>
            <p className="mt-1 text-lg font-semibold text-[#dde1e4]">{formatDuration(uptime.seconds)}</p>
            <p className="text-[11px] text-[#8896b4]">dernier redémarrage</p>
          </div>
        )}
      </div>
      {failed(interfaces) ? (
        <Unavailable what="Interfaces réseau" reason={interfaces.error} />
      ) : interfaces.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[#8896b4]">Interfaces réseau</p>
          <ul className="divide-y divide-[#132255] rounded-lg border border-[#132255] bg-[#080d24]">
            {interfaces.map((nic) => (
              <li key={nic.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-[#dde1e4]">
                  {nic.name}
                  {nic.type ? <span className="text-[#8896b4]"> · {nic.type}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-[#8896b4]">
                  {nic.speedMbps !== null ? `lien ${nic.speedMbps} Mbit/s (max)` : "vitesse inconnue"}
                  {nic.connected === null ? null : nic.connected ? (
                    <Badge className="bg-green-500/10 text-green-400 border-green-500/25">connecté</Badge>
                  ) : (
                    <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">déconnecté</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <DiscoveredBlock items={stats.discovered} />
    </div>
  );
}

type Stream = {
  enabled: boolean | null;
  codec: string | null;
  resolution: string | null;
  fps: number | null;
  bitrateKbps: number | null;
};

function streamLabel(stream: Stream | null): string {
  if (!stream) return "—";
  if (stream.enabled === false) return "désactivé";
  return [stream.codec, stream.resolution, stream.fps ? `${stream.fps} i/s` : null, stream.bitrateKbps ? `${stream.bitrateKbps} kbit/s max` : null]
    .filter(Boolean)
    .join(" · ");
}

function CamerasResult({ result }: { result: Record<string, unknown> }) {
  const summary = result.summary as { channels: number; online: number; offline: number; configuredKbps: number };
  const cameras = (result.cameras ?? []) as {
    channel: number;
    title: string | null;
    online: boolean | null;
    address: string | null;
    model: string | null;
    main: Stream | null;
    sub: Stream | null;
  }[];
  const unavailable = (result.unavailable ?? {}) as Record<string, string>;
  if (cameras.length === 0) return <Empty>Aucune voie vidéo remontée par l&apos;enregistreur.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#dde1e4]">
        {summary.channels} voie{summary.channels > 1 ? "s" : ""} ·{" "}
        <span className="text-green-400">{summary.online} en ligne</span>
        {summary.offline > 0 && <span className="text-red-400"> · {summary.offline} en perte vidéo</span>}
        {summary.configuredKbps > 0 && (
          <span className="text-[#8896b4]">
            {" "}
            · débit maximal configuré {(summary.configuredKbps / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}{" "}
            Mbit/s
          </span>
        )}
      </p>
      <ul className="divide-y divide-[#132255] rounded-lg border border-[#132255] bg-[#080d24]">
        {cameras.map((camera) => (
          <li key={camera.channel} className="space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-[#dde1e4]">
                <span className="text-[#8896b4]">Voie {camera.channel} — </span>
                {camera.title ?? "sans titre"}
              </span>
              {camera.online === null ? (
                <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">état inconnu</Badge>
              ) : camera.online ? (
                <Badge className="bg-green-500/10 text-green-400 border-green-500/25">en ligne</Badge>
              ) : (
                <Badge className="bg-red-500/10 text-red-400 border-red-500/25">perte vidéo</Badge>
              )}
            </div>
            {(camera.address || camera.model) && (
              <p className="text-[11px] text-[#8896b4]">
                {[camera.model, camera.address].filter(Boolean).join(" · ")}
              </p>
            )}
            <p className="text-[11px] text-[#8896b4]">
              Principal : {streamLabel(camera.main)} — Secondaire : {streamLabel(camera.sub)}
            </p>
          </li>
        ))}
      </ul>
      {Object.keys(unavailable).length > 0 && (
        <p className="text-[11px] text-[#8896b4]">
          Informations partielles : {Object.entries(unavailable).map(([k, v]) => `${k} (${v})`).join(" ; ")}
        </p>
      )}
    </div>
  );
}

function PoeResult({
  result,
  onAction,
  busy,
}: {
  result: Record<string, unknown>;
  onAction?: OnAction;
  busy?: boolean;
}) {
  const ports = (result.ports ?? []) as { port: number; enabled: boolean | null }[];
  const rpc = result.rpc as { methods?: string[]; results?: unknown[] } | Failure | undefined;
  const confirmAndRun = (port: number, mode: "on" | "off" | "cycle") => {
    const label =
      mode === "off"
        ? `Couper l'alimentation du port ${port} ? La caméra branchée s'éteindra.`
        : mode === "on"
          ? `Rétablir l'alimentation du port ${port} ?`
          : `Redémarrer la caméra du port ${port} (coupure de 10 s puis rétablissement) ?`;
    if (window.confirm(label)) onAction?.("poe-power", { port, mode });
  };
  return (
    <div className="space-y-3">
      {ports.length === 0 ? (
        <p className="text-sm text-[#8896b4]">
          Pilotage PoE non exposé par ce firmware
          {typeof result.configError === "string" ? ` (${result.configError})` : ""}. Le diagnostic « Capacités du
          firmware » liste les méthodes PoE disponibles, pour l&apos;adapter.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {ports.map((port) => (
            <li key={port.port} className="flex items-center justify-between gap-2 rounded-lg border border-[#132255] bg-[#080d24] px-3 py-2">
              <span className="text-sm text-[#dde1e4] flex items-center gap-2">
                Port {port.port}
                {port.enabled === null ? (
                  <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">?</Badge>
                ) : port.enabled ? (
                  <Badge className="bg-green-500/10 text-green-400 border-green-500/25">alimenté</Badge>
                ) : (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/25">coupé</Badge>
                )}
              </span>
              {onAction && port.enabled !== null && (
                <span className="flex gap-1.5">
                  {port.enabled ? (
                    <>
                      <PoeButton disabled={busy} onClick={() => confirmAndRun(port.port, "cycle")}>
                        Redémarrer
                      </PoeButton>
                      <PoeButton disabled={busy} danger onClick={() => confirmAndRun(port.port, "off")}>
                        Couper
                      </PoeButton>
                    </>
                  ) : (
                    <PoeButton disabled={busy} onClick={() => confirmAndRun(port.port, "on")}>
                      Rétablir
                    </PoeButton>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {rpc && !failed(rpc) && Array.isArray(rpc.results) && <DiscoveredBlock items={rpc.results} />}
    </div>
  );
}

function PoeButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        danger
          ? "border-red-500/25 text-red-400 hover:bg-red-500/10"
          : "border-[#132255] text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4]"
      }`}
    >
      {children}
    </button>
  );
}

function PoePowerResult({
  result,
  onAction,
  busy,
}: {
  result: Record<string, unknown>;
  onAction?: OnAction;
  busy?: boolean;
}) {
  const verb = result.mode === "off" ? "coupé" : result.mode === "on" ? "rétabli" : "redémarré";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className={`text-sm ${result.dryRun ? "text-[#dde1e4]" : result.confirmed ? "text-green-400" : "text-amber-300"}`}>
        {result.dryRun
          ? `Simulation : port ${String(result.port)} — écriture de ${String(result.key)} = ${JSON.stringify(result.wouldWrite)}`
          : result.confirmed
            ? `Port ${String(result.port)} ${verb} — état relu sur l'enregistreur : ${result.current ? "alimenté" : "coupé"}.`
            : `Commande envoyée au port ${String(result.port)}, mais l'état relu ne correspond pas (${String(result.current)}).`}
      </p>
      {onAction && (
        <PoeButton disabled={busy} onClick={() => onAction("poe-status", {})}>
          Rafraîchir les ports
        </PoeButton>
      )}
    </div>
  );
}

function LogsResult({ result }: { result: Record<string, unknown> }) {
  const entries = (result.entries ?? []) as { time: string | null; type: string | null; user: string | null; detail: string | null }[];
  if (entries.length === 0) return <Empty>Aucune entrée de journal sur la période.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#8896b4]">
        {entries.length} entrée{entries.length > 1 ? "s" : ""} affichée{entries.length > 1 ? "s" : ""} sur{" "}
        {String(result.total)} — du {String(result.from)} au {String(result.to)}
      </p>
      <ul className="max-h-96 divide-y divide-[#132255] overflow-auto rounded-lg border border-[#132255] bg-[#080d24]">
        {entries.map((entry, index) => (
          <li key={index} className="px-3 py-2">
            <p className="text-sm text-[#dde1e4]">
              <span className="font-mono text-[11px] text-[#8896b4]">{entry.time ?? "—"}</span>{" "}
              {entry.type ?? "?"}
              {entry.user ? <span className="text-[#8896b4]"> · {entry.user}</span> : null}
            </p>
            {entry.detail && <p className="text-[11px] text-[#8896b4] break-words">{entry.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CapabilitiesResult({ result }: { result: Record<string, unknown> }) {
  const rpc = result.rpc as
    | { available: true; methodCount: number; groups: Record<string, string[]> }
    | { available: false; error: string };
  const sections = (result.configSections ?? {}) as Record<string, boolean | string>;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-[#8896b4]">API RPC2</p>
        {rpc.available ? (
          <>
            <p className="text-sm text-[#dde1e4]">{rpc.methodCount} méthodes exposées par le firmware.</p>
            <ul className="space-y-1">
              {Object.entries(rpc.groups).map(([group, methods]) => (
                <li key={group} className="text-[11px] text-[#8896b4]">
                  <span className="text-[#dde1e4]">{group}</span> ({methods.length}) :{" "}
                  <span className="font-mono break-words">{methods.join(", ") || "—"}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Unavailable what="RPC2" reason={rpc.error} />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-[#8896b4]">Sections de configuration</p>
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(sections).map(([name, present]) => (
            <li
              key={name}
              title={typeof present === "string" ? present : undefined}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                present === true
                  ? "border-green-500/25 bg-green-500/10 text-green-400"
                  : "border-[#132255] bg-[#080d24] text-[#8896b4]/60 line-through"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

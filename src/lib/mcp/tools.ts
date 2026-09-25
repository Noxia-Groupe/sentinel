import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import type { Scope } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { alarmStats, getEvent, listEvents, updateEvent } from "@/lib/alarm-service";
import {
  EVENT_STATUSES,
  SEVERITIES,
  isEventStatus,
  isSeverity,
  type EventSeverity,
  type EventStatus,
} from "@/lib/dahua/events";
import { isReachable, loadNvr, testNvrConnection } from "@/lib/dahua/service";
import { executeNvrAction, isNvrAction, NVR_ACTIONS, type NvrActionName } from "@/lib/dahua/actions";
import { checkNvr, getSupervisionConfig, nvrHealth } from "@/lib/supervision";
import { supervisionDefinition, type SupervisionIssue } from "@/lib/dahua/events";

/**
 * Outils MCP exposés aux agents (Hermes Agent…).
 *
 * Chaque outil délègue aux mêmes fonctions que l'API `/api/v1` : mêmes
 * contrôles, même journal d'audit. La lecture des mots de passe n'est
 * volontairement PAS exposée ici — un agent n'en a pas besoin pour superviser
 * ni pour agir, Sentinel se connecte lui-même aux enregistreurs.
 */

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = { content: ToolContent[]; isError?: boolean };

type JsonSchema = Record<string, unknown>;

export type McpTool = {
  name: string;
  title: string;
  description: string;
  /** Scope requis ; pour `nvr_action`, calculé selon l'action (voir allowed). */
  scope: Scope;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  run: (args: Record<string, unknown>, actor: Actor, scopes: string[]) => Promise<ToolResult>;
};

export class ToolInputError extends Error {}

function text(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new ToolInputError(`Paramètre « ${key} » requis`);
    return undefined;
  }
  if (typeof value !== "string") throw new ToolInputError(`Paramètre « ${key} » : chaîne attendue`);
  return value;
}

function list(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.split(",").map((v) => v.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map(String);
  throw new ToolInputError(`Paramètre « ${key} » : liste attendue`);
}

/** Alarme allégée : sans charge utile brute, pour ménager le contexte de l'agent. */
function compactAlarm(event: Awaited<ReturnType<typeof listEvents>>["events"][number]) {
  return {
    id: event.id,
    title: event.title,
    type: event.type,
    severity: event.severity,
    status: event.status,
    channel: event.channel,
    receivedAt: event.receivedAt,
    acknowledgedBy: event.acknowledgedBy,
    nvr: { id: event.nvr.id, name: event.nvr.name, status: event.nvr.status },
    client: event.nvr.client?.name ?? null,
  };
}

const NVR_INCLUDE = {
  client: { select: { id: true, name: true, code: true } },
  credentials: { select: { id: true, type: true, username: true, lastTestOk: true } },
  _count: {
    select: { events: { where: { status: { in: ["new", "acknowledged", "in_progress"] } } } },
  },
} satisfies Prisma.NvrInclude;

type NvrWithRelations = Prisma.NvrGetPayload<{ include: typeof NVR_INCLUDE }>;

function serializeNvr(nvr: NvrWithRelations) {
  return {
    id: nvr.id,
    name: nvr.name,
    client: nvr.client,
    model: nvr.model,
    firmware: nvr.firmware,
    serialNumber: nvr.serialNumber,
    location: nvr.location,
    connectionMode: nvr.connectionMode,
    status: nvr.status,
    reachable: isReachable(nvr),
    lastSeen: nvr.lastSeen,
    lastCheck: { at: nvr.lastCheckAt, ok: nvr.lastCheckOk, message: nvr.lastCheckMessage },
    // Identifiants : type et nom seulement, jamais le mot de passe.
    credentials: nvr.credentials,
    openAlarms: nvr._count.events,
  };
}

/** Actions d'intervention qu'un jeu de scopes autorise. */
export function allowedActions(scopes: string[]): NvrActionName[] {
  return (Object.keys(NVR_ACTIONS) as NvrActionName[]).filter((name) =>
    scopes.includes(NVR_ACTIONS[name].scope),
  );
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "sentinel_overview",
    title: "Vue d'ensemble",
    description:
      "État global : alarmes en cours par criticité et statut, enregistreurs en ligne / hors ligne, nombre de clients. Point de départ recommandé.",
    scope: "alarms:read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => {
      const [alarms, total, online, offline, clients, config, faulty] = await Promise.all([
        alarmStats(),
        prisma.nvr.count(),
        prisma.nvr.count({ where: { status: "online" } }),
        prisma.nvr.count({ where: { status: "offline" } }),
        prisma.client.count(),
        getSupervisionConfig(),
        prisma.nvr.findMany({
          where: { monitored: true, NOT: { healthIssues: { isEmpty: true } } },
          select: { id: true, name: true, healthIssues: true },
        }),
      ]);
      return text({
        alarms,
        nvrs: { total, online, offline },
        clients,
        supervision: {
          enabled: config.enabled,
          intervalMinutes: config.intervalMinutes,
          lastRunAt: config.lastRunAt,
          nvrsWithIssues: faulty.map((nvr) => ({
            id: nvr.id,
            name: nvr.name,
            issues: (nvr.healthIssues as SupervisionIssue[]).map((issue) => supervisionDefinition(issue).title),
          })),
        },
        generatedAt: new Date().toISOString(),
      });
    },
  },
  {
    name: "list_alarms",
    title: "Lister les alarmes",
    description:
      "Alarmes du centre d'alarme, plus récentes d'abord. Filtrer par statut (new = non traitée), criticité, enregistreur, client ou texte.",
    scope: "alarms:read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string", enum: EVENT_STATUSES } },
        severity: { type: "array", items: { type: "string", enum: SEVERITIES } },
        nvrId: { type: "string" },
        clientId: { type: "string" },
        search: { type: "string", description: "Recherche sur le libellé, le type, le NVR ou le client" },
        since: { type: "string", description: "Date ISO 8601 minimale de réception" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const status = list(args, "status")?.filter(isEventStatus) as EventStatus[] | undefined;
      const severity = list(args, "severity")?.filter(isSeverity) as EventSeverity[] | undefined;
      const sinceRaw = str(args, "since");
      const since = sinceRaw ? new Date(sinceRaw) : undefined;
      if (since && Number.isNaN(since.getTime())) throw new ToolInputError("« since » : date ISO invalide");
      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100);
      const page = await listEvents({
        status,
        severity,
        nvrId: str(args, "nvrId"),
        clientId: str(args, "clientId"),
        search: str(args, "search"),
        since,
        limit,
      });
      return text({ total: page.total, returned: page.events.length, alarms: page.events.map(compactAlarm) });
    },
  },
  {
    name: "get_alarm",
    title: "Détail d'une alarme",
    description: "Alarme complète : charge utile reçue de l'enregistreur, main courante et historique de traitement.",
    scope: "alarms:read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const event = await getEvent(str(args, "id", true)!);
      return event ? text(event) : failure("Alarme introuvable");
    },
  },
  {
    name: "update_alarm",
    title: "Traiter une alarme",
    description:
      "Change le statut d'une alarme (acknowledged = prise en compte, in_progress, resolved = clôturée, ignored) et/ou ajoute une entrée à la main courante. Tracé au nom de la clé de l'agent.",
    scope: "alarms:write",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: EVENT_STATUSES },
        resolution: { type: "string", description: "Motif de clôture" },
        comment: { type: "string", description: "Entrée de main courante" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (args, actor) => {
      const status = str(args, "status");
      if (status !== undefined && !isEventStatus(status)) {
        throw new ToolInputError(`Statut invalide (attendu : ${EVENT_STATUSES.join(", ")})`);
      }
      const resolution = str(args, "resolution");
      const comment = str(args, "comment")?.trim();
      if (!status && resolution === undefined && !comment) {
        throw new ToolInputError("Rien à modifier : fournir status, resolution ou comment");
      }
      const event = await updateEvent(
        str(args, "id", true)!,
        { status: status as EventStatus | undefined, resolution, comment: comment || undefined },
        actor,
      );
      return event
        ? text({ id: event.id, status: event.status, acknowledgedBy: event.acknowledgedBy, resolvedAt: event.resolvedAt })
        : failure("Alarme introuvable");
    },
  },
  {
    name: "list_clients",
    title: "Lister les clients",
    description: "Clients et nombre d'enregistreurs de chacun.",
    scope: "nvr:read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => {
      const clients = await prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true, active: true, _count: { select: { nvrs: true } } },
      });
      return text(
        clients.map((c) => ({ id: c.id, name: c.name, code: c.code, active: c.active, nvrs: c._count.nvrs })),
      );
    },
  },
  {
    name: "list_nvrs",
    title: "Lister les enregistreurs",
    description:
      "Inventaire des enregistreurs : état en ligne / hors ligne, dernier test, alarmes ouvertes. Filtrer par client, statut ou texte.",
    scope: "nvr:read",
    inputSchema: {
      type: "object",
      properties: {
        clientId: { type: "string" },
        status: { type: "string", enum: ["online", "offline", "unknown"] },
        search: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const search = str(args, "search");
      const nvrs = await prisma.nvr.findMany({
        where: {
          ...(str(args, "clientId") ? { clientId: str(args, "clientId") } : {}),
          ...(str(args, "status") ? { status: str(args, "status") } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { location: { contains: search, mode: "insensitive" as const } },
                  { serialNumber: { contains: search, mode: "insensitive" as const } },
                  { client: { name: { contains: search, mode: "insensitive" as const } } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        include: NVR_INCLUDE,
      });
      return text(nvrs.map(serializeNvr));
    },
  },
  {
    name: "get_nvr",
    title: "Détail d'un enregistreur",
    description: "Fiche d'un enregistreur et ses 5 derniers tests de connexion.",
    scope: "nvr:read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const id = str(args, "id", true)!;
      const nvr = await prisma.nvr.findUnique({ where: { id }, include: NVR_INCLUDE });
      if (!nvr) return failure("Enregistreur introuvable");
      const checks = await prisma.connectionCheck.findMany({
        where: { nvrId: id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { success: true, latencyMs: true, message: true, actorLabel: true, createdAt: true },
      });
      return text({ ...serializeNvr(nvr), recentChecks: checks });
    },
  },
  {
    name: "test_nvr",
    title: "Tester un enregistreur",
    description:
      "Teste réellement l'accès à l'enregistreur (via IP ou tunnel P2P) avec un compte enregistré : joignabilité, latence, modèle, firmware et droits du compte. Un échec n'est pas une erreur : le résultat porte ok=false et le motif.",
    scope: "nvr:test",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        credentialId: { type: "string", description: "Compte à utiliser (défaut : administrateur)" },
        includeRights: { type: "boolean", default: true },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args, actor) => {
      const nvr = await loadNvr(str(args, "id", true)!);
      if (!nvr) return failure("Enregistreur introuvable");
      const result = await testNvrConnection({
        nvr,
        credentialId: str(args, "credentialId"),
        includeRights: args.includeRights !== false,
        actor,
      });
      return text({ nvr: { id: nvr.id, name: nvr.name }, ...result });
    },
  },
  {
    name: "get_nvr_health",
    title: "Supervision d'un enregistreur",
    description:
      "Résultat de la supervision permanente : anomalies ouvertes (injoignable, identifiants refusés, stockage, horloge), taux de disponibilité 24 h / 7 j et historique des vérifications automatiques.",
    scope: "nvr:read",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 20, description: "Vérifications à renvoyer" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const health = await nvrHealth(str(args, "id", true)!, Number(args.limit ?? 20) || 20);
      return health ? text(health) : failure("Enregistreur introuvable");
    },
  },
  {
    name: "run_health_check",
    title: "Vérifier un enregistreur maintenant",
    description:
      "Lance immédiatement la vérification de supervision (joignabilité, compte, disques, horloge), l'historise, et ouvre ou clôture les alarmes de supervision en conséquence.",
    scope: "nvr:test",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run: async (args, actor) => {
      const id = str(args, "id", true)!;
      const result = await checkNvr(id);
      if (!result) return failure("Enregistreur introuvable");
      await recordAudit({
        actor,
        action: "nvr.health_check",
        targetType: "nvr",
        targetId: id,
        success: result.ok,
        metadata: { message: result.message, openIssues: result.openIssues },
      });
      return text(result);
    },
  },
  {
    name: "nvr_action",
    title: "Intervenir sur un enregistreur",
    description:
      "Intervention à distance. Lecture (scope nvr:test) : device-info, users, channels, storage, alarm-out-state, alarm-center, event-indexes (params.code), snapshot (params.channel, renvoie l'image). Action (scope nvr:control) : sync-time, alarm-out (params.index, params.active), configure-alarm-center (params.dryRun…), reboot. Toutes les interventions sont tracées.",
    scope: "nvr:test",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Identifiant de l'enregistreur" },
        action: { type: "string", enum: Object.keys(NVR_ACTIONS) },
        params: { type: "object", description: "Paramètres propres à l'action" },
        credentialId: { type: "string" },
      },
      required: ["id", "action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    run: async (args, actor, scopes) => {
      const action = args.action;
      if (!isNvrAction(action)) throw new ToolInputError("Action inconnue");
      const required = NVR_ACTIONS[action].scope;
      if (!scopes.includes(required)) {
        // Même trace que l'API v1 : un agent qui sort de son périmètre se voit.
        await recordAudit({
          actor,
          action: "api.scope_denied",
          targetType: "apikey",
          targetId: actor.id,
          success: false,
          metadata: { requiredScope: required, mcpTool: "nvr_action", nvrAction: action },
        });
        return failure(`Cette clé n'a pas le scope « ${required} » requis par l'action « ${action} ».`);
      }
      const nvr = await loadNvr(str(args, "id", true)!);
      if (!nvr) return failure("Enregistreur introuvable");
      const params =
        typeof args.params === "object" && args.params !== null && !Array.isArray(args.params)
          ? (args.params as Record<string, unknown>)
          : {};
      const outcome = await executeNvrAction({
        nvr,
        action,
        params,
        credentialId: str(args, "credentialId"),
        actor,
      });
      if (!outcome.ok) return failure(`${outcome.reason} : ${outcome.message}`);

      // Capture : renvoyée comme image, exploitable par un modèle multimodal.
      if (action === "snapshot") {
        const data = outcome.data as { base64: string; contentType: string; channel: number };
        return {
          content: [
            { type: "text", text: `Capture du canal ${data.channel} — ${nvr.name}` },
            { type: "image", data: data.base64, mimeType: data.contentType },
          ],
        };
      }
      return text({ nvr: { id: nvr.id, name: nvr.name }, action, data: outcome.data });
    },
  },
];

/** Un outil est-il utilisable avec ces scopes ? */
export function toolAllowed(tool: McpTool, scopes: string[]): boolean {
  if (tool.name === "nvr_action") return allowedActions(scopes).length > 0;
  return scopes.includes(tool.scope);
}

/** Description publiée d'un outil, restreinte à ce que la clé autorise. */
export function describeTool(tool: McpTool, scopes: string[]) {
  let inputSchema = tool.inputSchema;
  if (tool.name === "nvr_action") {
    const properties = { ...(tool.inputSchema.properties as Record<string, unknown>) };
    properties.action = { type: "string", enum: allowedActions(scopes) };
    inputSchema = { ...tool.inputSchema, properties };
  }
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

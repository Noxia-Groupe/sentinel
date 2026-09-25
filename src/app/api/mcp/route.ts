import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { requestIp } from "@/lib/actor";
import { MCP_TOOLS, ToolInputError, describeTool, toolAllowed } from "@/lib/mcp/tools";

/**
 * Serveur MCP (Model Context Protocol) de Sentinel — transport « Streamable
 * HTTP », en mode sans état : chaque POST porte un message JSON-RPC 2.0 et
 * reçoit sa réponse en JSON.
 *
 * Destiné aux agents (Hermes Agent…) : ils découvrent les outils de Sentinel
 * et les appellent, dans la limite des scopes de leur clé d'API.
 *
 * Authentification : `Authorization: Bearer <clé d'API Sentinel>`.
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INSTRUCTIONS =
  "Sentinel est le centre d'alarme des enregistreurs vidéo Dahua (NVR) du parc. " +
  "Commencer par sentinel_overview, puis list_alarms (status=new pour les alarmes non traitées). " +
  "Avant d'agir sur une alarme, vérifier l'équipement (test_nvr, nvr_action snapshot/storage). " +
  "Consigner chaque analyse dans la main courante (update_alarm avec comment). " +
  "Les actions sensibles (reboot, alarm-out, configure-alarm-center) exigent une justification claire.";

type JsonRpcId = string | number | null;
type JsonRpcRequest = { jsonrpc?: string; id?: JsonRpcId; method?: unknown; params?: unknown };

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

/** Refuse un appel issu d'une page web tierce (anti DNS rebinding). */
function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // client serveur (Hermes) : pas d'en-tête Origin
  const allowed = [process.env.NEXTAUTH_URL, process.env.AUTH_URL]
    .filter(Boolean)
    .map((url) => new URL(url!).origin);
  return allowed.includes(origin);
}

export async function POST(req: Request) {
  if (!originAllowed(req)) {
    return NextResponse.json(rpcError(null, -32000, "Origine non autorisée"), { status: 403 });
  }

  const auth = await authenticateApiKey(req);
  if (!auth.ok) {
    return NextResponse.json(rpcError(null, -32001, auth.error), {
      status: auth.status,
      headers: auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="sentinel"' } : undefined,
    });
  }

  const rate = checkRateLimit(auth.keyId);
  if (!rate.allowed) {
    return NextResponse.json(
      rpcError(null, -32002, `Trop de requêtes — limite de ${rate.limit} par minute atteinte`),
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "JSON invalide"), { status: 400 });
  }

  const actor = { ...auth.actor, ip: requestIp(req) };
  const handle = (message: JsonRpcRequest) => handleMessage(message, actor, auth.scopes, auth.keyId);

  // Lot JSON-RPC (versions antérieures du protocole) : réponses dans l'ordre,
  // sans les notifications.
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handle(m as JsonRpcRequest)))).filter(Boolean);
    return responses.length ? NextResponse.json(responses) : new NextResponse(null, { status: 202 });
  }

  const response = await handle(body as JsonRpcRequest);
  // Notification (pas d'identifiant) : accusé de réception sans corps.
  return response ? NextResponse.json(response) : new NextResponse(null, { status: 202 });
}

/** Pas de flux SSE initié par le serveur : Sentinel répond à chaque POST. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

async function handleMessage(
  message: JsonRpcRequest,
  actor: Parameters<(typeof MCP_TOOLS)[number]["run"]>[1],
  scopes: string[],
  keyId: string,
) {
  const isNotification = message?.id === undefined;
  const id: JsonRpcId = message?.id ?? null;

  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return isNotification ? null : rpcError(id, -32600, "Requête JSON-RPC invalide");
  }
  if (isNotification) return null; // notifications/initialized, cancelled…

  const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Record<
    string,
    unknown
  >;

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sentinel", title: "Sentinel — centre d'alarme NVR", version: "1.0.0" },
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.filter((tool) => toolAllowed(tool, scopes)).map((tool) => describeTool(tool, scopes)),
      });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
      if (!tool) return rpcError(id, -32602, `Outil inconnu : ${name}`);

      if (!toolAllowed(tool, scopes)) {
        // Même trace que l'API v1 : un agent qui sort de son périmètre se voit.
        await recordAudit({
          actor,
          action: "api.scope_denied",
          targetType: "apikey",
          targetId: keyId,
          success: false,
          metadata: { requiredScope: tool.scope, mcpTool: name },
        });
        return rpcResult(id, {
          content: [{ type: "text", text: `Cette clé n'a pas le scope « ${tool.scope} » requis par ${name}.` }],
          isError: true,
        });
      }

      const args =
        typeof params.arguments === "object" && params.arguments !== null && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        return rpcResult(id, await tool.run(args, actor, scopes));
      } catch (error) {
        if (error instanceof ToolInputError) return rpcError(id, -32602, error.message);
        console.error(`[mcp] ${name}`, error);
        return rpcResult(id, {
          content: [{ type: "text", text: "Erreur interne de Sentinel pendant l'exécution de l'outil." }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Méthode non prise en charge : ${message.method}`);
  }
}

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

/**
 * Couche transport vers l'API CGI des équipements Dahua.
 *
 * On n'utilise pas `fetch` ici pour deux raisons :
 *  - les NVR exigent une authentification HTTP Digest, qu'`undici` n'implémente pas ;
 *  - en HTTPS ils présentent un certificat auto-signé, qu'il faut pouvoir accepter.
 */

export type DahuaTarget = {
  host: string;
  port: number;
  useHttps: boolean;
  username: string;
  password: string;
  /** Délai maximum d'une requête, bornes comprises (défaut : 8 s). */
  timeoutMs?: number;
};

export type DahuaHttpResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

/** Raison d'échec normalisée, exposée telle quelle par l'API. */
export type DahuaFailureReason =
  | "unreachable" // hôte injoignable, port fermé, délai dépassé
  | "auth" // identifiants refusés (401 après digest)
  | "forbidden" // compte connu mais droits insuffisants / bloqué
  | "http" // l'équipement répond mais avec un code inattendu
  | "unsupported" // opération impossible dans cette configuration (P2P…)
  | "invalid"; // configuration incomplète côté SENTINEL

export class DahuaError extends Error {
  constructor(
    readonly reason: DahuaFailureReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DahuaError";
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

/** Découpe l'en-tête `WWW-Authenticate` en paires clé/valeur. */
function parseAuthenticateHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  // `key="value"` ou `key=value`, séparés par des virgules (valeurs pouvant en contenir).
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(header)) !== null) {
    params[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return params;
}

function buildDigestHeader(
  target: DahuaTarget,
  method: string,
  uri: string,
  challenge: Record<string, string>,
): string {
  const realm = challenge.realm ?? "";
  const nonce = challenge.nonce ?? "";
  const opaque = challenge.opaque;
  const algorithm = (challenge.algorithm ?? "MD5").toUpperCase();
  // Les firmwares annoncent parfois `qop="auth,auth-int"` : on ne gère que `auth`.
  const qop = challenge.qop?.split(",").map((q) => q.trim()).includes("auth")
    ? "auth"
    : undefined;

  const cnonce = crypto.randomBytes(8).toString("hex");
  const nc = "00000001";

  let ha1 = md5(`${target.username}:${realm}:${target.password}`);
  if (algorithm === "MD5-SESS") {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }
  const ha2 = md5(`${method}:${uri}`);

  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${target.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (algorithm) parts.push(`algorithm=${algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);

  return `Digest ${parts.join(", ")}`;
}

function basicHeader(target: DahuaTarget): string {
  const raw = Buffer.from(`${target.username}:${target.password}`).toString("base64");
  return `Basic ${raw}`;
}

function rawRequest(
  target: DahuaTarget,
  method: string,
  path: string,
  authorization?: string,
): Promise<DahuaHttpResponse> {
  const transport = target.useHttps ? https : http;
  const timeout = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        host: target.host,
        port: target.port,
        path,
        method,
        timeout,
        headers: {
          // Certains firmwares refusent les requêtes sans User-Agent.
          "User-Agent": "Sentinel/1.0",
          Accept: "*/*",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        // Les NVR embarquent un certificat auto-signé : la validation de chaîne
        // n'apporte rien ici, la confiance repose sur le réseau (LAN/VPN).
        ...(target.useHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );

    req.on("timeout", () => {
      req.destroy(new DahuaError("unreachable", `Délai dépassé après ${timeout} ms`));
    });

    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof DahuaError) return reject(error);
      reject(new DahuaError("unreachable", describeNetworkError(error)));
    });

    req.end();
  });
}

function describeNetworkError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "ECONNREFUSED":
      return "Connexion refusée — port fermé ou service web désactivé sur l'enregistreur";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "Hôte injoignable — vérifier le routage, le VPN ou l'ouverture de port";
    case "ETIMEDOUT":
    case "ECONNRESET":
      return "Pas de réponse de l'enregistreur (délai dépassé)";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "Nom d'hôte introuvable";
    case "EPROTO":
      return "Erreur de négociation TLS — essayer sans HTTPS";
    default:
      return error.message || "Erreur réseau inconnue";
  }
}

/**
 * Exécute une requête CGI en gérant la négociation d'authentification
 * (Digest, avec repli sur Basic si l'équipement ne propose que ça).
 */
export async function dahuaRequest(
  target: DahuaTarget,
  path: string,
  method: "GET" | "POST" = "GET",
): Promise<DahuaHttpResponse> {
  if (!target.host) {
    throw new DahuaError("invalid", "Adresse de l'enregistreur non renseignée");
  }

  const first = await rawRequest(target, method, path);
  if (first.status !== 401) return ensureOk(first);

  const challengeHeader = first.headers["www-authenticate"];
  const header = Array.isArray(challengeHeader) ? challengeHeader[0] : challengeHeader;

  if (!header) {
    throw new DahuaError("auth", "Authentification refusée par l'enregistreur", 401);
  }

  const authorization = /^\s*digest/i.test(header)
    ? buildDigestHeader(target, method, path, parseAuthenticateHeader(header))
    : basicHeader(target);

  const second = await rawRequest(target, method, path, authorization);

  if (second.status === 401) {
    throw new DahuaError(
      "auth",
      "Identifiants refusés par l'enregistreur — mot de passe invalide ou compte verrouillé",
      401,
    );
  }

  return ensureOk(second);
}

function ensureOk(res: DahuaHttpResponse): DahuaHttpResponse {
  if (res.status === 401) {
    throw new DahuaError("auth", "Identifiants refusés par l'enregistreur", 401);
  }
  if (res.status === 403) {
    throw new DahuaError(
      "forbidden",
      "Accès refusé — le compte n'a pas le droit d'exécuter cette opération",
      403,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.body.toString("utf8").trim().slice(0, 200);
    throw new DahuaError(
      "http",
      `Réponse inattendue de l'enregistreur (HTTP ${res.status})${detail ? ` : ${detail}` : ""}`,
      res.status,
    );
  }
  return res;
}

/** Variante texte : la quasi-totalité des CGI Dahua répondent en `key=value`. */
export async function dahuaRequestText(
  target: DahuaTarget,
  path: string,
  method: "GET" | "POST" = "GET",
): Promise<string> {
  const res = await dahuaRequest(target, path, method);
  return res.body.toString("utf8");
}

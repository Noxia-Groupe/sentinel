import crypto from "node:crypto";
import { DahuaError, dahuaPostJson, type DahuaTarget } from "./http";

/**
 * Client de l'API JSON « RPC2 » des équipements Dahua — celle qu'utilise leur
 * interface web. Plus riche que l'API CGI pour la maintenance : charge
 * processeur, mémoire, temps de fonctionnement, interfaces réseau, et la liste
 * exacte des méthodes que le firmware expose (`system.listMethod`).
 *
 * Authentification en deux temps sur `/RPC2_Login` :
 *   1. `global.login` sans mot de passe → défi (`realm`, `random`, `encryption`) ;
 *   2. `global.login` avec
 *      MD5(user:random:MD5(user:realm:pass)) en hexadécimal majuscule.
 * La session obtenue est ensuite passée à chaque appel sur `/RPC2`.
 */

type RpcResponse = {
  id?: number;
  result?: unknown;
  params?: unknown;
  session?: string | number;
  error?: { code?: number; message?: string };
};

const md5 = (value: string) => crypto.createHash("md5").update(value).digest("hex").toUpperCase();

/** Code renvoyé par le 1er `global.login` : défi attendu, pas une erreur. */
const CHALLENGE_CODES = new Set([268632079, 401]);
const BAD_CREDENTIALS = 268632085;
const ACCOUNT_LOCKED = 268632081;

export function rpcPasswordHash(
  username: string,
  password: string,
  challenge: { realm?: string; random?: string; encryption?: string },
): string {
  switch (challenge.encryption) {
    case "Basic":
      return Buffer.from(`${username}:${password}`).toString("base64");
    case "Default":
    case undefined:
      return md5(`${username}:${challenge.random ?? ""}:${md5(`${username}:${challenge.realm ?? ""}:${password}`)}`);
    default:
      return password;
  }
}

export class RpcSession {
  private nextId = 10;

  constructor(
    private readonly target: DahuaTarget,
    private readonly session: string | number,
  ) {}

  /** Appel brut : renvoie la réponse telle quelle (résultat, paramètres, erreur). */
  async raw(method: string, params: unknown = null): Promise<RpcResponse> {
    return (await dahuaPostJson(this.target, "/RPC2", {
      method,
      params,
      id: this.nextId++,
      session: this.session,
    })) as RpcResponse;
  }

  /** Appel typé : renvoie `params`, lève une `DahuaError` si l'équipement refuse. */
  async call<T = unknown>(method: string, params: unknown = null): Promise<T> {
    const res = await this.raw(method, params);
    if (res.result === false || res.error) {
      const code = res.error?.code;
      throw new DahuaError(
        "http",
        `${method} refusé par l'équipement${code ? ` (code ${code}${res.error?.message ? ` — ${res.error.message}` : ""})` : ""}`,
      );
    }
    return (res.params ?? res.result) as T;
  }

  async logout(): Promise<void> {
    await this.raw("global.logout").catch(() => undefined);
  }
}

export async function rpcLogin(target: DahuaTarget): Promise<RpcSession> {
  const first = (await dahuaPostJson(target, "/RPC2_Login", {
    method: "global.login",
    params: { userName: target.username, password: "", loginType: "Direct", clientType: "Web3.0" },
    id: 1,
  })) as RpcResponse;

  const challenge = (first.params ?? {}) as { realm?: string; random?: string; encryption?: string };
  if (first.session === undefined || !first.error?.code || !CHALLENGE_CODES.has(first.error.code)) {
    throw new DahuaError("unsupported", "Connexion RPC2 impossible : défi d'authentification absent");
  }

  const second = (await dahuaPostJson(target, "/RPC2_Login", {
    method: "global.login",
    params: {
      userName: target.username,
      password: rpcPasswordHash(target.username, target.password, challenge),
      loginType: challenge.encryption === "WatchNet" ? "WatchNet" : "Direct",
      clientType: "Web3.0",
      authorityType: challenge.encryption ?? "Default",
    },
    id: 2,
    session: first.session,
  })) as RpcResponse;

  if (second.result !== true) {
    const code = second.error?.code;
    if (code === BAD_CREDENTIALS) {
      throw new DahuaError("auth", "Identifiants refusés par l'enregistreur (RPC2)");
    }
    if (code === ACCOUNT_LOCKED) {
      throw new DahuaError("forbidden", "Compte verrouillé sur l'enregistreur (trop d'essais)");
    }
    throw new DahuaError("http", `Connexion RPC2 refusée${code ? ` (code ${code})` : ""}`);
  }

  return new RpcSession(target, second.session ?? first.session);
}

/** Ouvre une session RPC2, exécute `run`, puis ferme la session quoi qu'il arrive. */
export async function withRpc<T>(target: DahuaTarget, run: (rpc: RpcSession) => Promise<T>): Promise<T> {
  const rpc = await rpcLogin(target);
  try {
    return await run(rpc);
  } finally {
    await rpc.logout();
  }
}

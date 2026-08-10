import type { Nvr, NvrCredential } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import type { Actor } from "@/lib/actor";
import { DahuaError, type DahuaFailureReason, type DahuaTarget } from "./http";
import { isP2pAvailable, openTunnel } from "./p2p";
import {
  getRightsForAccount,
  testConnection,
  type DeviceInfo,
  type RightsSummary,
} from "./client";

/**
 * Couche « métier » entre les routes HTTP et l'API des enregistreurs :
 * résolution de la cible, déchiffrement du mot de passe, historisation du
 * résultat et journal d'audit.
 */

export type NvrWithCredentials = Nvr & { credentials: NvrCredential[] };

export type ConnectionTestResult = {
  ok: boolean;
  reason?: DahuaFailureReason;
  message: string;
  latencyMs?: number;
  device?: DeviceInfo;
  rights?: RightsSummary;
  credential?: { id: string; type: string; username: string };
  checkedAt: string;
};

/** Délai réseau appliqué aux appels sortants vers les enregistreurs. */
const TIMEOUT_MS = Number(process.env.DAHUA_TIMEOUT_MS ?? 8000);

/** Cible résolue, accompagnée de la libération du tunnel P2P le cas échéant. */
export type ResolvedTarget = { target: DahuaTarget; release: () => void };

/**
 * Construit la cible réseau à partir d'un NVR et d'un compte enregistré.
 *
 * En mode P2P, l'équipement n'a pas d'adresse joignable : un tunnel est ouvert
 * via le cloud Dahua à partir de son numéro de série, et la cible devient le
 * port local de ce tunnel. Le reste de la plateforme n'a pas à s'en soucier.
 *
 * Lève une `DahuaError` explicite quand la configuration ne permet pas
 * d'atteindre l'équipement.
 */
export async function resolveTarget(
  nvr: Nvr,
  credential: NvrCredential,
): Promise<ResolvedTarget> {
  const username = credential.username;
  const password = decrypt(credential.encryptedPassword);

  if (nvr.connectionMode === "p2p") {
    const serial = nvr.p2pSerial ?? nvr.serialNumber;
    if (!serial) {
      throw new DahuaError(
        "invalid",
        "Aucun numéro de série P2P renseigné pour cet enregistreur",
      );
    }

    const tunnel = await openTunnel({
      serial,
      devicePort: nvr.httpPort,
      username,
      password,
    });

    return {
      target: {
        host: tunnel.host,
        port: tunnel.port,
        // Le tunnel achemine le TCP tel quel : si l'équipement parle en TLS,
        // la négociation se fait de bout en bout à travers le tunnel.
        useHttps: nvr.useHttps,
        username,
        password,
        timeoutMs: TIMEOUT_MS,
      },
      release: tunnel.release,
    };
  }

  if (!nvr.ip) {
    throw new DahuaError("invalid", "Aucune adresse IP renseignée pour cet enregistreur");
  }

  return {
    target: {
      host: nvr.ip,
      port: nvr.httpPort,
      useHttps: nvr.useHttps,
      username,
      password,
      timeoutMs: TIMEOUT_MS,
    },
    release: () => {},
  };
}

/** Indique si un enregistreur est atteignable dans la configuration actuelle. */
export function isReachable(nvr: Nvr): boolean {
  return nvr.connectionMode === "p2p"
    ? isP2pAvailable() && Boolean(nvr.p2pSerial ?? nvr.serialNumber)
    : Boolean(nvr.ip);
}

/**
 * Choisit le compte à utiliser : celui demandé, sinon un compte administrateur,
 * sinon le premier enregistré.
 */
export function pickCredential(
  nvr: NvrWithCredentials,
  credentialId?: string | null,
): NvrCredential | undefined {
  if (credentialId) return nvr.credentials.find((c) => c.id === credentialId);
  return nvr.credentials.find((c) => c.type === "admin") ?? nvr.credentials[0];
}

export function describeError(error: unknown): { reason: DahuaFailureReason; message: string } {
  if (error instanceof DahuaError) return { reason: error.reason, message: error.message };
  if (error instanceof Error) return { reason: "http", message: error.message };
  return { reason: "http", message: "Erreur inconnue" };
}

export async function loadNvr(nvrId: string): Promise<NvrWithCredentials | null> {
  return prisma.nvr.findUnique({ where: { id: nvrId }, include: { credentials: true } });
}

/**
 * Teste la connexion à un enregistreur avec un compte enregistré et, si
 * demandé, relève les droits effectifs de ce compte sur l'équipement.
 *
 * Le résultat est historisé (`ConnectionCheck`) et reporté sur le NVR et le
 * compte utilisé, que le test réussisse ou non.
 */
export async function testNvrConnection(options: {
  nvr: NvrWithCredentials;
  credentialId?: string | null;
  includeRights?: boolean;
  actor: Actor;
}): Promise<ConnectionTestResult> {
  const { nvr, credentialId, includeRights = true, actor } = options;
  const checkedAt = new Date();

  const credential = pickCredential(nvr, credentialId);
  if (!credential) {
    const message = credentialId
      ? "Compte introuvable pour cet enregistreur"
      : "Aucun compte enregistré pour cet enregistreur — ajouter au moins un identifiant.";
    await recordAudit({
      actor,
      action: "nvr.test",
      targetType: "nvr",
      targetId: nvr.id,
      success: false,
      metadata: { reason: "invalid", message },
    });
    return { ok: false, reason: "invalid", message, checkedAt: checkedAt.toISOString() };
  }

  const credentialRef = {
    id: credential.id,
    type: credential.type,
    username: credential.username,
  };

  let result: ConnectionTestResult;
  let device: DeviceInfo | undefined;
  let rights: RightsSummary | undefined;
  let resolved: ResolvedTarget | undefined;

  try {
    resolved = await resolveTarget(nvr, credential);
    const { latencyMs, device: info } = await testConnection(resolved.target);
    device = info;

    if (includeRights) {
      // L'échec de la lecture des droits ne remet pas en cause la connexion.
      rights = await getRightsForAccount(resolved.target).catch(() => undefined);
    }

    result = {
      ok: true,
      message:
        `Connexion établie avec le compte « ${credential.username} »` +
        (nvr.connectionMode === "p2p" ? " via le tunnel P2P" : ""),
      latencyMs,
      device,
      rights,
      credential: credentialRef,
      checkedAt: checkedAt.toISOString(),
    };
  } catch (error) {
    const { reason, message } = describeError(error);
    result = {
      ok: false,
      reason,
      message,
      credential: credentialRef,
      checkedAt: checkedAt.toISOString(),
    };
  } finally {
    resolved?.release();
  }

  await persistCheck({ nvr, credential, result, device, rights, actor });

  await recordAudit({
    actor,
    action: "nvr.test",
    targetType: "nvr",
    targetId: nvr.id,
    success: result.ok,
    metadata: {
      credentialId: credential.id,
      username: credential.username,
      reason: result.reason,
      latencyMs: result.latencyMs,
    },
  });

  return result;
}

async function persistCheck(input: {
  nvr: Nvr;
  credential: NvrCredential;
  result: ConnectionTestResult;
  device?: DeviceInfo;
  rights?: RightsSummary;
  actor: Actor;
}): Promise<void> {
  const { nvr, credential, result, device, rights, actor } = input;

  try {
    await prisma.$transaction([
      prisma.connectionCheck.create({
        data: {
          nvrId: nvr.id,
          credentialId: credential.id,
          success: result.ok,
          latencyMs: result.latencyMs ?? null,
          message: result.message,
          device: (device ?? undefined) as object | undefined,
          rights: (rights ?? undefined) as object | undefined,
          actorType: actor.type,
          actorId: actor.id ?? null,
          actorLabel: actor.label,
        },
      }),
      prisma.nvr.update({
        where: { id: nvr.id },
        data: {
          lastCheckAt: new Date(),
          lastCheckOk: result.ok,
          lastCheckMessage: result.message,
          // Un test réussi vaut preuve de vie ; un échec réseau bascule le NVR
          // hors ligne, mais un simple refus d'identifiants ne le fait pas.
          status: result.ok
            ? "online"
            : result.reason === "unreachable"
              ? "offline"
              : nvr.status,
          ...(result.ok ? { lastSeen: new Date() } : {}),
          ...(result.ok && device
            ? {
                model: device.deviceType ?? nvr.model,
                firmware: device.softwareVersion ?? nvr.firmware,
                // Le SN est unique en base : on ne l'écrase que s'il est vide.
                ...(nvr.serialNumber || !device.serialNumber
                  ? {}
                  : { serialNumber: device.serialNumber }),
              }
            : {}),
        },
      }),
      prisma.nvrCredential.update({
        where: { id: credential.id },
        data: {
          lastTestedAt: new Date(),
          lastTestOk: result.ok,
          ...(rights ? { rights: rights as unknown as object } : {}),
        },
      }),
    ]);
  } catch (error) {
    console.error("[dahua] Échec d'enregistrement du test de connexion", error);
  }
}

/**
 * Teste successivement tous les comptes enregistrés d'un NVR.
 * Sert à valider un parc de mots de passe et à repérer les comptes obsolètes.
 */
export async function testAllCredentials(options: {
  nvr: NvrWithCredentials;
  actor: Actor;
}): Promise<ConnectionTestResult[]> {
  const results: ConnectionTestResult[] = [];
  for (const credential of options.nvr.credentials) {
    results.push(
      await testNvrConnection({
        nvr: options.nvr,
        credentialId: credential.id,
        includeRights: true,
        actor: options.actor,
      }),
    );
  }
  return results;
}

/**
 * Exécute une action distante (redémarrage, mise à l'heure, capture…) avec un
 * compte enregistré, en journalisant systématiquement le résultat.
 */
export async function runNvrAction<T>(options: {
  nvr: NvrWithCredentials;
  credentialId?: string | null;
  action: string;
  actor: Actor;
  metadata?: Record<string, unknown>;
  run: (target: DahuaTarget) => Promise<T>;
}): Promise<{ ok: true; data: T } | { ok: false; reason: DahuaFailureReason; message: string }> {
  const { nvr, credentialId, action, actor, metadata, run } = options;

  const credential = pickCredential(nvr, credentialId);
  if (!credential) {
    const message = "Aucun compte enregistré pour cet enregistreur";
    await recordAudit({
      actor,
      action,
      targetType: "nvr",
      targetId: nvr.id,
      success: false,
      metadata: { ...metadata, reason: "invalid", message },
    });
    return { ok: false, reason: "invalid", message };
  }

  let resolved: ResolvedTarget | undefined;
  try {
    resolved = await resolveTarget(nvr, credential);
    const data = await run(resolved.target);
    await recordAudit({
      actor,
      action,
      targetType: "nvr",
      targetId: nvr.id,
      success: true,
      metadata: { ...metadata, credentialId: credential.id, username: credential.username },
    });
    return { ok: true, data };
  } catch (error) {
    const { reason, message } = describeError(error);
    await recordAudit({
      actor,
      action,
      targetType: "nvr",
      targetId: nvr.id,
      success: false,
      metadata: { ...metadata, credentialId: credential.id, reason, message },
    });
    return { ok: false, reason, message };
  } finally {
    resolved?.release();
  }
}

/** Code HTTP correspondant à une raison d'échec côté équipement. */
export function statusForReason(reason: DahuaFailureReason | undefined): number {
  switch (reason) {
    case "auth":
      return 401;
    case "forbidden":
      return 403;
    case "invalid":
      return 400;
    case "unsupported":
      return 409;
    case "unreachable":
      return 504;
    default:
      return 502;
  }
}

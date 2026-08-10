import { prisma } from "./prisma";
import { decrypt } from "./crypto";
import { recordAudit } from "./audit";
import type { Actor } from "./actor";

/**
 * Lecture d'un mot de passe enregistré.
 *
 * C'est l'opération la plus sensible de la plateforme : elle est isolée ici
 * pour garantir qu'aucune lecture n'échappe au journal d'audit, qu'elle vienne
 * de l'interface ou d'une clé d'API.
 */
export async function revealCredential(options: {
  nvrId: string;
  credentialId: string;
  actor: Actor;
  /** Motif éventuel fourni par l'appelant (agent IA, intervention…). */
  reason?: string;
}) {
  const { nvrId, credentialId, actor, reason } = options;

  const credential = await prisma.nvrCredential.findFirst({
    where: { id: credentialId, nvrId },
    include: { nvr: { select: { name: true } } },
  });

  if (!credential) return null;

  let password: string;
  try {
    password = decrypt(credential.encryptedPassword);
  } catch (error) {
    await recordAudit({
      actor,
      action: "credential.reveal",
      targetType: "credential",
      targetId: credentialId,
      success: false,
      metadata: { nvrId, reason, error: "déchiffrement impossible" },
    });
    console.error("[credentials] Déchiffrement impossible", credentialId, error);
    throw new Error(
      "Déchiffrement impossible — la clé ENCRYPTION_KEY a-t-elle changé depuis l'enregistrement ?",
    );
  }

  await recordAudit({
    actor,
    action: "credential.reveal",
    targetType: "credential",
    targetId: credentialId,
    metadata: { nvrId, nvr: credential.nvr.name, username: credential.username, reason },
  });

  return {
    id: credential.id,
    type: credential.type,
    label: credential.label,
    username: credential.username,
    password,
  };
}

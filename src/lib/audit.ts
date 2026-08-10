import { prisma } from "./prisma";
import type { Actor } from "./actor";

export type AuditEntry = {
  actor: Actor;
  /** Verbe normalisé : `nvr.test`, `credential.reveal`, `event.acknowledge`… */
  action: string;
  targetType?: "nvr" | "event" | "credential" | "client" | "apikey" | "system";
  targetId?: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Écrit une entrée dans le journal d'audit.
 *
 * Ne lève jamais : une panne d'écriture du journal ne doit pas faire échouer
 * l'opération métier — l'erreur est remontée dans les logs du conteneur.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: entry.actor.type,
        actorId: entry.actor.id ?? null,
        actorLabel: entry.actor.label,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        success: entry.success ?? true,
        metadata: (entry.metadata ?? undefined) as object | undefined,
        ip: entry.actor.ip ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Échec d'écriture du journal", entry.action, error);
  }
}

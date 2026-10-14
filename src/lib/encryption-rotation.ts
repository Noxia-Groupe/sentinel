import { prisma } from "./prisma";
import { decrypt, encrypt, isCurrentKey } from "./crypto";
import { recordAudit } from "./audit";
import { SYSTEM_ACTOR } from "./actor";

/**
 * Réécrit avec la clé courante tous les secrets chiffrés avec une autre clé
 * (rotation de `ENCRYPTION_KEY`) ou dans l'ancien format sans identifiant de
 * clé. Lancée au démarrage ; sans rien à faire, elle ne coûte qu'une lecture
 * par table. Un chiffré illisible est laissé tel quel et signalé.
 */
export async function rotateEncryptedSecrets(): Promise<{ credentials: number; webhooks: number; failed: number }> {
  let failed = 0;

  const credentials = await prisma.nvrCredential.findMany({ select: { id: true, encryptedPassword: true } });
  let rotatedCredentials = 0;
  for (const credential of credentials) {
    if (isCurrentKey(credential.encryptedPassword)) continue;
    try {
      const encryptedPassword = encrypt(decrypt(credential.encryptedPassword));
      await prisma.nvrCredential.update({ where: { id: credential.id }, data: { encryptedPassword } });
      rotatedCredentials += 1;
    } catch (error) {
      failed += 1;
      console.error(`[crypto] Rotation impossible pour le compte ${credential.id}`, error);
    }
  }

  const endpoints = await prisma.webhookEndpoint.findMany({ select: { id: true, secretEncrypted: true } });
  let rotatedWebhooks = 0;
  for (const endpoint of endpoints) {
    if (isCurrentKey(endpoint.secretEncrypted)) continue;
    try {
      const secretEncrypted = encrypt(decrypt(endpoint.secretEncrypted));
      await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { secretEncrypted } });
      rotatedWebhooks += 1;
    } catch (error) {
      failed += 1;
      console.error(`[crypto] Rotation impossible pour le webhook ${endpoint.id}`, error);
    }
  }

  if (rotatedCredentials || rotatedWebhooks || failed) {
    console.info(
      `[crypto] Secrets réécrits avec la clé courante : ${rotatedCredentials} compte(s), ${rotatedWebhooks} webhook(s)` +
        (failed ? `, ${failed} échec(s)` : ""),
    );
    await recordAudit({
      actor: SYSTEM_ACTOR,
      action: "system.encryption_rotate",
      targetType: "system",
      success: failed === 0,
      metadata: { credentials: rotatedCredentials, webhooks: rotatedWebhooks, failed },
    });
  }
  return { credentials: rotatedCredentials, webhooks: rotatedWebhooks, failed };
}

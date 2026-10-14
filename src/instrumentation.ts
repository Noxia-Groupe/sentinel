/**
 * Démarrage du serveur : lance les tâches de fond.
 * - le worker qui reprend les livraisons de webhooks sortants en échec
 *   (src/lib/outbound-webhooks.ts) ;
 * - l'horloge de la supervision permanente des enregistreurs
 *   (src/lib/supervision.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Pas de tâche de fond pendant `next build` : aucune base n'y est joignable.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  checkConfiguration();
  const { startWebhookWorker } = await import("./lib/outbound-webhooks");
  startWebhookWorker();
  if (process.env.SUPERVISION_DISABLED !== "1") {
    const { startSupervisionWorker } = await import("./lib/supervision");
    startSupervisionWorker();
  }
}

/**
 * Erreurs de configuration qui ferment l'accès : signalées dès le démarrage,
 * pas au premier utilisateur qui se présente.
 */
function checkConfiguration(): void {
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim() ?? "";
  if (!/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i.test(issuer)) {
    console.error(
      "[auth] AUTH_MICROSOFT_ENTRA_ID_ISSUER doit désigner le tenant Entra " +
        "(https://login.microsoftonline.com/<GUID du tenant>/v2.0) : toutes les connexions seront refusées.",
    );
  }
}

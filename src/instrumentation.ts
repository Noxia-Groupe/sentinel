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
  const { startWebhookWorker } = await import("./lib/outbound-webhooks");
  startWebhookWorker();
  if (process.env.SUPERVISION_DISABLED !== "1") {
    const { startSupervisionWorker } = await import("./lib/supervision");
    startSupervisionWorker();
  }
}

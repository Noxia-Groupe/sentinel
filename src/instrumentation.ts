/**
 * Démarrage du serveur : lance le worker qui reprend les livraisons de
 * webhooks sortants en échec (délai croissant, voir src/lib/outbound-webhooks.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Pas de worker pendant `next build` : aucune base n'y est joignable.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWebhookWorker } = await import("./lib/outbound-webhooks");
  startWebhookWorker();
}

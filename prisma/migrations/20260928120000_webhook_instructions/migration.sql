-- Consignes envoyées à l'agent (Hermes) avec chaque webhook sortant.
-- Idempotent (rejoué à chaque démarrage).
ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "alarmInstructions" TEXT;
ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "outageInstructions" TEXT;

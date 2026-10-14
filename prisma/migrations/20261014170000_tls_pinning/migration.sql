-- Épinglage du certificat TLS des enregistreurs joints en HTTPS (src/lib/dahua/http.ts).
-- Idempotent : rejoué à chaque démarrage (voir entrypoint.sh).
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "tlsFingerprint" TEXT;

-- Supervision permanente des enregistreurs : état par NVR, historique des
-- vérifications et réglages. Idempotent (rejoué à chaque démarrage).
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "monitored" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "healthIssues" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "HealthCheck" (
    "id" TEXT NOT NULL,
    "nvrId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "issues" TEXT[],
    "message" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HealthCheck_nvrId_createdAt_idx" ON "HealthCheck"("nvrId", "createdAt");
CREATE INDEX IF NOT EXISTS "HealthCheck_createdAt_idx" ON "HealthCheck"("createdAt");

DO $$ BEGIN
    ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_nvrId_fkey"
        FOREIGN KEY ("nvrId") REFERENCES "Nvr"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupervisionConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "offlineThreshold" INTEGER NOT NULL DEFAULT 2,
    "clockDriftMinutes" INTEGER NOT NULL DEFAULT 5,
    "lastRunAt" TIMESTAMP(3),
    "lastRunDurationMs" INTEGER,
    "lastRunChecked" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupervisionConfig_pkey" PRIMARY KEY ("id")
);

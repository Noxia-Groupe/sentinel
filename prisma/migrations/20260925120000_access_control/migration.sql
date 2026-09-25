-- Liste d'accès à la plateforme (autorisé / banni / en attente, rôle).
-- Idempotent : entrypoint.sh rejoue toutes les migrations à chaque démarrage.
CREATE TABLE IF NOT EXISTS "AccessEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "addedBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccessEntry_email_key" ON "AccessEntry"("email");
CREATE INDEX IF NOT EXISTS "AccessEntry_status_idx" ON "AccessEntry"("status");

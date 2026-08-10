-- Centre d'alarme : clients, triage des événements, tests de connexion,
-- clés d'API pour agents IA et journal d'audit.
-- Toutes les instructions sont idempotentes : `entrypoint.sh` rejoue l'intégralité
-- des migrations à chaque démarrage.

-- ============================================================
-- Clients
-- ============================================================
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Client_code_key" ON "Client"("code");
CREATE INDEX IF NOT EXISTS "Client_name_idx" ON "Client"("name");

-- ============================================================
-- NVR : rattachement client, accès CGI, dernier test
-- ============================================================
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "httpPort" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "useHttps" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "firmware" TEXT;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "lastCheckAt" TIMESTAMP(3);
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "lastCheckOk" BOOLEAN;
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "lastCheckMessage" TEXT;

CREATE INDEX IF NOT EXISTS "Nvr_clientId_idx" ON "Nvr"("clientId");
CREATE INDEX IF NOT EXISTS "Nvr_status_idx" ON "Nvr"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Nvr_clientId_fkey') THEN
        ALTER TABLE "Nvr" ADD CONSTRAINT "Nvr_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- Credentials : plusieurs comptes du même type par NVR
-- ============================================================
ALTER TABLE "NvrCredential" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "NvrCredential" ADD COLUMN IF NOT EXISTS "lastTestedAt" TIMESTAMP(3);
ALTER TABLE "NvrCredential" ADD COLUMN IF NOT EXISTS "lastTestOk" BOOLEAN;
ALTER TABLE "NvrCredential" ADD COLUMN IF NOT EXISTS "rights" JSONB;

DROP INDEX IF EXISTS "NvrCredential_nvrId_type_key";
CREATE UNIQUE INDEX IF NOT EXISTS "NvrCredential_nvrId_type_username_key"
    ON "NvrCredential"("nvrId", "type", "username");

-- ============================================================
-- Événements : triage
-- ============================================================
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "channel" INTEGER;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "severity" TEXT NOT NULL DEFAULT 'info';
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'webhook';
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "acknowledgedById" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "acknowledgedByKey" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "NvrEvent" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;

CREATE INDEX IF NOT EXISTS "NvrEvent_status_receivedAt_idx" ON "NvrEvent"("status", "receivedAt");
CREATE INDEX IF NOT EXISTS "NvrEvent_severity_receivedAt_idx" ON "NvrEvent"("severity", "receivedAt");
CREATE INDEX IF NOT EXISTS "NvrEvent_receivedAt_idx" ON "NvrEvent"("receivedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NvrEvent_acknowledgedById_fkey') THEN
        ALTER TABLE "NvrEvent" ADD CONSTRAINT "NvrEvent_acknowledgedById_fkey"
            FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NvrEvent_resolvedById_fkey') THEN
        ALTER TABLE "NvrEvent" ADD CONSTRAINT "NvrEvent_resolvedById_fkey"
            FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NvrEvent_assignedToId_fkey') THEN
        ALTER TABLE "NvrEvent" ADD CONSTRAINT "NvrEvent_assignedToId_fkey"
            FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- Main courante des événements
-- ============================================================
CREATE TABLE IF NOT EXISTS "EventComment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorLabel" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EventComment_eventId_createdAt_idx" ON "EventComment"("eventId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventComment_eventId_fkey') THEN
        ALTER TABLE "EventComment" ADD CONSTRAINT "EventComment_eventId_fkey"
            FOREIGN KEY ("eventId") REFERENCES "NvrEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventComment_authorId_fkey') THEN
        ALTER TABLE "EventComment" ADD CONSTRAINT "EventComment_authorId_fkey"
            FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- Historique des tests de connexion
-- ============================================================
CREATE TABLE IF NOT EXISTS "ConnectionCheck" (
    "id" TEXT NOT NULL,
    "nvrId" TEXT NOT NULL,
    "credentialId" TEXT,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER,
    "message" TEXT,
    "device" JSONB,
    "rights" JSONB,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "actorId" TEXT,
    "actorLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConnectionCheck_nvrId_createdAt_idx" ON "ConnectionCheck"("nvrId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConnectionCheck_nvrId_fkey') THEN
        ALTER TABLE "ConnectionCheck" ADD CONSTRAINT "ConnectionCheck_nvrId_fkey"
            FOREIGN KEY ("nvrId") REFERENCES "Nvr"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConnectionCheck_credentialId_fkey') THEN
        ALTER TABLE "ConnectionCheck" ADD CONSTRAINT "ConnectionCheck_credentialId_fkey"
            FOREIGN KEY ("credentialId") REFERENCES "NvrCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- Clés d'API (intégrations et agents IA)
-- ============================================================
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_prefix_key" ON "ApiKey"("prefix");
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_hash_key" ON "ApiKey"("hash");
CREATE INDEX IF NOT EXISTS "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_createdById_fkey') THEN
        ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ============================================================
-- Journal d'audit
-- ============================================================
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

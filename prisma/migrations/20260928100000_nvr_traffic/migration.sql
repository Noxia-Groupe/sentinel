-- Trafic réseau Sentinel ↔ enregistreur : cumuls horaires par origine.
-- Idempotent (rejoué à chaque démarrage).
CREATE TABLE IF NOT EXISTS "NvrTraffic" (
    "id" TEXT NOT NULL,
    "nvrId" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NvrTraffic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NvrTraffic_nvrId_bucket_origin_key" ON "NvrTraffic"("nvrId", "bucket", "origin");
CREATE INDEX IF NOT EXISTS "NvrTraffic_bucket_idx" ON "NvrTraffic"("bucket");

DO $$ BEGIN
    ALTER TABLE "NvrTraffic" ADD CONSTRAINT "NvrTraffic_nvrId_fkey"
        FOREIGN KEY ("nvrId") REFERENCES "Nvr"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Port RTSP des enregistreurs (vidéo en direct). Idempotent.
ALTER TABLE "Nvr" ADD COLUMN IF NOT EXISTS "rtspPort" INTEGER NOT NULL DEFAULT 554;

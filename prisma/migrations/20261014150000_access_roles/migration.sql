-- Rôles : l'ancien « user » (tout sauf les paramètres) devient « admin », aux
-- droits équivalents ; les nouvelles autorisations sont « operator » par défaut.
-- Idempotent : rejoué à chaque démarrage (voir entrypoint.sh).
UPDATE "AccessEntry" SET "role" = 'admin' WHERE "role" = 'user';
ALTER TABLE "AccessEntry" ALTER COLUMN "role" SET DEFAULT 'operator';

-- Jetons OAuth : la plateforme ne les utilise jamais après la connexion et ne
-- les stocke plus (src/lib/auth.ts). Ceux déjà en base sont effacés.
UPDATE "Account"
SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL,
    "expires_at" = NULL, "session_state" = NULL
WHERE "access_token" IS NOT NULL OR "refresh_token" IS NOT NULL OR "id_token" IS NOT NULL
   OR "expires_at" IS NOT NULL OR "session_state" IS NOT NULL;

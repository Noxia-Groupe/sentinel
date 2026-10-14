#!/bin/sh
set -e

echo "🔐 SENTINEL — Démarrage..."

# Attendre que la BDD soit prête
echo "⏳ Attente de la base de données..."
until pg_isready -d "$DATABASE_URL" 2>/dev/null; do
  sleep 2
done

echo "✅ Base de données accessible"

# Appliquer les migrations SQL.
#
# Un registre (_sentinel_migrations) retient ce qui a été appliqué : chaque
# migration ne l'est qu'une fois, dans une transaction, et un échec ARRÊTE le
# démarrage — un schéma incomplet ferait échouer des contrôles sans que
# personne ne le voie. Au premier démarrage avec le registre (base existante
# ou neuve), les fichiers sont rejoués comme avant, de façon tolérante, puis
# enregistrés : seules les migrations suivantes sont strictes.
echo "🔄 Exécution des migrations..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  'CREATE TABLE IF NOT EXISTS "_sentinel_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now())'
recorded=$(psql "$DATABASE_URL" -tA -c 'SELECT count(*) FROM "_sentinel_migrations"')

for f in /app/prisma/migrations/*/migration.sql; do
  name=$(basename "$(dirname "$f")")
  applied=$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM \"_sentinel_migrations\" WHERE \"name\" = '$name'")
  if [ "$applied" = "1" ]; then
    continue
  fi
  if [ "$recorded" = "0" ]; then
    echo "  → $name (amorçage du registre)"
    psql "$DATABASE_URL" -q -f "$f" 2>&1 || echo "  ⚠️  $name : erreurs ignorées pendant l'amorçage (comportement historique)"
  else
    echo "  → $name"
    if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$f"; then
      echo "❌ Migration en échec : $name — démarrage interrompu, schéma inchangé pour cette migration" >&2
      exit 1
    fi
  fi
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO \"_sentinel_migrations\" (\"name\") VALUES ('$name') ON CONFLICT DO NOTHING"
done

echo "🚀 Démarrage de l'application..."
exec node server.js

#!/bin/sh
set -e

echo "🔐 SENTINEL — Démarrage..."

# Attendre que la BDD soit prête
echo "⏳ Attente de la base de données..."
until pg_isready -d "$DATABASE_URL" 2>/dev/null; do
  sleep 2
done

echo "✅ Base de données accessible"

# Appliquer les migrations SQL
echo "🔄 Exécution des migrations..."
for f in /app/prisma/migrations/*/migration.sql; do
  echo "  → $(basename $(dirname $f))"
  psql "$DATABASE_URL" -f "$f" -q 2>&1 || true
done

echo "🚀 Démarrage de l'application..."
exec node server.js

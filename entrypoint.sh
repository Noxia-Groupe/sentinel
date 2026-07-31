#!/bin/sh
set -e

echo "🔐 SENTINEL — Démarrage..."

# Attendre que la BDD soit prête
echo "⏳ Attente de la base de données..."
until node -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query('SELECT 1').then(() => { process.exit(0); }).catch(() => { process.exit(1); });
" 2>/dev/null; do
  sleep 2
done

echo "✅ Base de données accessible"

# Lancer les migrations Prisma
echo "🔄 Exécution des migrations..."
npx prisma migrate deploy

echo "🚀 Démarrage de l'application..."
exec node server.js

# syntax=docker.io/docker/dockerfile:1

FROM node:22-alpine AS base

# --- Tunnel P2P Dahua ---------------------------------------------------------
# Compile l'utilitaire `dh-fwd` (vendoré sous vendor/dh-fwd, licence MIT) qui
# ouvre un tunnel vers un enregistreur à partir de son seul numéro de série,
# via le cloud Dahua. dh-fwd gère les firmwares postérieurs à 2024.07 (canal
# authentifié + dialecte DMSS/SmartPSS) là où l'ancien `dh-p2p` échouait par un
# `403 DevPwd_InvalidNonce`. Voir vendor/dh-fwd/VENDOR.md.
#
# Dépendances Go figées sous vendor/ : build hermétique, sans accès réseau.
# CGO désactivé → binaire statique, indépendant de la libc de l'image finale.
FROM golang:1.25-alpine AS p2p-builder
WORKDIR /build
COPY vendor/dh-fwd/ ./
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags="-s -w" -o /usr/local/bin/dh-fwd .

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# Build
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache postgresql-client

# Utilitaire de tunnel P2P, joignable via le défaut DAHUA_P2P_HELPER.
COPY --from=p2p-builder /usr/local/bin/dh-fwd /usr/local/bin/dh-fwd

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Le standalone Next.js inclut toutes les dépendances (prisma, @prisma, pg, etc.)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/app/entrypoint.sh"]

# syntax=docker.io/docker/dockerfile:1

FROM node:22-alpine AS base

# --- Tunnel P2P Dahua ---------------------------------------------------------
# Compile l'utilitaire `dh-p2p` (vendoré sous vendor/dh-p2p, licence MIT) qui
# ouvre un tunnel vers un enregistreur à partir de son seul numéro de série,
# via le cloud Dahua. On compile sur la même base musl (Alpine) que l'image Node,
# donc le binaire tourne tel quel dans l'image finale.
FROM rust:1-alpine AS p2p-builder
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY vendor/dh-p2p/ ./
RUN cargo build --release

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
COPY --from=p2p-builder /build/target/release/dh-p2p /usr/local/bin/dh-p2p

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

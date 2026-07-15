# MODULAR: Multi-stage Dockerfile for VERSIONS Next.js app.
# Produces a standalone Next.js server image.
#
# Build:  docker build -t versions .
# Run:    docker run -p 3000:3000 --env-file .env versions

FROM node:22-alpine AS base

# ── Dependencies ──────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ── Builder ───────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# MODULAR: Next.js 16.2.9 Turbopack regression workaround.
# See README "Why --experimental-build-mode compile".
RUN npm run build

# ── Runner ────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy the standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy the scripts directory for DB migration scripts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

# MODULAR: Multi-stage Dockerfile for VERSIONS Next.js app.
# Uses Next.js standalone output — only the server binary + traced
# dependencies are copied, not the full node_modules tree.
#
# Build:  docker build -t versions .
# Run:    docker run -p 3000:3000 --env-file .env versions

FROM node:22-alpine AS base

# ── Builder ───────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Install all deps (needed for build, including devDeps)
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# standalone output traces only what the server actually needs
RUN npm run build

# ── Runner ────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Static assets served by the standalone server
COPY --from=builder /app/public ./public

# Standalone server bundle (server.js + traced node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Local audio upload directory (fallback when IPFS is not configured)
RUN mkdir -p data/uploads && chown nextjs:nodejs data/uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

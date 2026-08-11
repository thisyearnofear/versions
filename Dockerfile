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

# ── Build-time client env ──────────────────────────────
# NEXT_PUBLIC_* vars are inlined into the browser bundle at build time.
# .dockerignore excludes .env from the context, so these must be injected
# as build args (public by definition — safe to bake into the image).
# Override per deploy with --build-arg.
ARG NEXT_PUBLIC_ARC_RPC_URL
ARG NEXT_PUBLIC_ARC_EXPLORER_URL
ARG NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS
ARG NEXT_PUBLIC_WC_PROJECT_ID
ENV NEXT_PUBLIC_ARC_RPC_URL=${NEXT_PUBLIC_ARC_RPC_URL} \
    NEXT_PUBLIC_ARC_EXPLORER_URL=${NEXT_PUBLIC_ARC_EXPLORER_URL} \
    NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS=${NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS} \
    NEXT_PUBLIC_WC_PROJECT_ID=${NEXT_PUBLIC_WC_PROJECT_ID}

# Install all deps (needed for build, including devDeps)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# `next build` triggers `npm run postbuild` → scripts/audit-nft-traces.sh,
# which shells out to bash (Alpine ships only busybox ash). Install bash for
# the builder only; the runner uses plain `node server.js` and stays minimal.
RUN apk add --no-cache bash

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

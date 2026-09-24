# VERSIONS API host image (nuncio-vultr).
# UI is on Netlify — this build strips App Router pages/components so the
# box image does not carry RainbowKit / browse-supply-channels UI.
#
# CI: .github/workflows/docker-image.yml → ghcr.io/thisyearnofear/versions
# Box: docker compose pull && up (see scripts/deploy.sh)

FROM node:22-alpine AS base

# ── Builder ───────────────────────────────────────────
FROM base AS builder
WORKDIR /app

ARG NEXT_PUBLIC_ARC_RPC_URL
ARG NEXT_PUBLIC_ARC_EXPLORER_URL
ARG NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS
ARG NEXT_PUBLIC_WC_PROJECT_ID
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL=https://versions.persidian.com
# api = strip UI tree before next build (default for the box image)
ARG VERSIONS_ROLE=api

ENV NEXT_PUBLIC_ARC_RPC_URL=${NEXT_PUBLIC_ARC_RPC_URL} \
    NEXT_PUBLIC_ARC_EXPLORER_URL=${NEXT_PUBLIC_ARC_EXPLORER_URL} \
    NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS=${NEXT_PUBLIC_SUBMIT_RECEIPT_TIMEOUT_MS} \
    NEXT_PUBLIC_WC_PROJECT_ID=${NEXT_PUBLIC_WC_PROJECT_ID} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    VERSIONS_ROLE=${VERSIONS_ROLE}

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN apk add --no-cache bash \
 && if [ "$VERSIONS_ROLE" = "api" ]; then bash scripts/prepare-api-tree.sh; fi \
 && npm run build

# ── Runner ────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Audio feature fallback probes shell out to ffmpeg (see src/lib/audio-features.ts)
RUN apk add --no-cache ffmpeg \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p data/uploads && chown nextjs:nodejs data/uploads

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

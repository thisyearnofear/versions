# MODULAR: single-process image. The proxy serves the API on :8080;
# the web client is static files served by the same process via a
# /web/* static route (added in proxy-server.js). One port, one
# process, one volume for the SQLite database.

FROM node:20-bookworm-slim

# PERFORMANT: production-only deps; better-sqlite3 compiles against
# the platform's glibc here (amd64) or musl (alpine) — debian-slim
# is the most reliable for arm64 dev + amd64 prod.
WORKDIR /app

# MODULAR: copy manifests first so the layer cache survives source
# changes. Then the source. Then install + run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY proxy-server.js ./
COPY proxy ./proxy
COPY data ./data
COPY web ./web

# CLEAN: data lives on a mounted volume in production. The default
# path inside the image is /app/data so the dev experience (just
# run node) matches the production experience (volume mount).
VOLUME ["/app/data"]

ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 8080

# PERFORMANT: the proxy auto-runs migrations on boot. No separate
# migrate step in the image.
CMD ["node", "proxy-server.js"]

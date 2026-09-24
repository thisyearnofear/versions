# Architecture split — marketplace UI vs API

**UI:** Netlify `versions-persidian` → https://versions.persidian.com  
**API:** box Traefik → https://api.versions.persidian.com  

## Product surface

Browse `/discover` · Supply `/submit` · Channels `/channels` ·  
`/listings/:id` · `/placements/:slotId` · `/t/:code` · `/legal/agreement`

UI pages live on Netlify. The box image is **API-only** (`VERSIONS_ROLE=api`):
`/api/*`, `/t/:code`, health, cron — no RainbowKit / Discover UI in the image.

## Env

| Where | Key | Value |
|-------|-----|--------|
| Netlify | `NEXT_PUBLIC_API_URL` | `https://api.versions.persidian.com` |
| Netlify | `NEXT_PUBLIC_APP_URL` | `https://versions.persidian.com` |
| Box | `ALLOWED_ORIGINS` | UI origins (apex + `*.netlify.app`) |
| Box | `VERSIONS_IMAGE` | optional override (default `ghcr.io/thisyearnofear/versions:<sha>`) |
| Box | `GHCR_TOKEN` | only if the GHCR package is private |

## DNS (Cloudflare `persidian.com`, DNS only)

| Type | Name | Content |
|------|------|---------|
| A | `api.versions` | `144.202.117.160` |
| CNAME | `versions` | `versions-persidian.netlify.app` |

Helper: `CLOUDFLARE_API_TOKEN=… ./scripts/dns-cutover-cloudflare.sh`

## Deploy (footprint)

1. `git push origin master` — Actions builds/pushes `ghcr.io/thisyearnofear/versions:<sha>`
2. `./scripts/deploy-remote.sh` — server **pulls** that tag (retries until CI finishes). No on-box `next build`.
3. Emergency only: `DEPLOY_BUILD_ON_BOX=1 ./scripts/deploy.sh`

UI: Netlify (`netlify deploy` or Git continuous deploy).

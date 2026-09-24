# Architecture split — marketplace UI vs API

**UI:** Netlify `versions-persidian` → https://versions.persidian.com  
**API:** box Traefik → https://api.versions.persidian.com  

## Product surface

Browse `/discover` · Supply `/submit` · Channels `/channels` ·  
`/listings/:id` · `/placements/:slotId` · `/t/:code` · `/legal/agreement`

## Env

| Where | Key | Value |
|-------|-----|--------|
| Netlify | `NEXT_PUBLIC_API_URL` | `https://api.versions.persidian.com` |
| Netlify | `NEXT_PUBLIC_APP_URL` | `https://versions.persidian.com` |
| Box | `ALLOWED_ORIGINS` | UI origins (apex + `*.netlify.app`) |

## DNS cutover

1. `api.versions.persidian.com` → VPS `144.202.117.160` (A record) — Traefik + LetsEncrypt  
2. `versions.persidian.com` → Netlify (CNAME `versions-persidian.netlify.app`, or Netlify DNS)  
3. Keep apex on Traefik until Netlify DNS is live so the site never goes dark  

## Deploy

- UI: Netlify (CLI `netlify deploy --build --prod` or Git continuous deploy)  
- API: `./scripts/deploy-remote.sh` on nuncio-vultr  

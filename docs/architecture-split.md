# Architecture split — marketplace UI vs API

Target: **thin UI** (Netlify) + **API on the box**, product = the wedge only.

## Product surface (keep)

| Door | Paths |
|------|--------|
| Browse | `/discover`, `GET /api/v1/marketplace/search` |
| Supply | `/submit`, `POST/GET /api/v1/listings`, submissions upload |
| Channels | `/channels`, verify, slots, usage |
| Attribution | `/listings/:id`, `/t/:code` |
| Settlement | slot pay / legs on Arc, cron sweep |
| Auth / legal | `/auth/signin`, `/legal/agreement` |

## Cut (deleted — not redirected)

Pages: `/agents`, `/supervisor`, `/feed`, `/cases`, `/artists`, `/listeners`, `/curators`, `/admin/*`  
UI: DiscoverView (briefs/licenses), AgentMonitor, FeedView, tips, economy ticker, AR, case thread  
API: agents, AR, listeners, curators, cases, licenses, supervisor, discover/brief, economy, events SSE, x402 tip/score, funnel/vitals  

## Config (split host)

| Env | Role |
|-----|------|
| `NEXT_PUBLIC_API_URL` | UI → box API |
| `ALLOWED_ORIGINS` | Box CORS allowlist for Netlify origin |
| `LOCAL_UPLOADS=0` + `PINATA_JWT` | No local audio on VPS |
| `SWEEP_ON_SSE=0` | Cron-only recovery (SSE gone) |

See [netlify.toml](../netlify.toml) and [deploy.md](./deploy.md).

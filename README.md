# ⚛️ VERSIONS — Lepton Submission Marketplace

**Hackathon target:** Lepton Agents (June 15–29, 2026).
**Status:** ✅ Phase 1 MVP shipped (Days 1–5 of `LEPTON_IMPLEMENTATION_PLAN.md` are complete; 54/54 tests green, demo smoke green).

This repo is on a single track: the **Lepton Submission Marketplace**. Every doc, script, and code path serves that one goal. Anything that does not was removed in Day 1.

| Doc                                          | Purpose                                       |
|----------------------------------------------|-----------------------------------------------|
| [`docs/LEPTON_STRATEGY.md`](docs/LEPTON_STRATEGY.md)               | The vision: why a marketplace for alternate takes. |
| [`docs/LEPTON_IMPLEMENTATION_PLAN.md`](docs/LEPTON_IMPLEMENTATION_PLAN.md) | The 5-day build plan and its execution log.  |
| [`docs/LEPTON_API.md`](docs/LEPTON_API.md)                     | The wire contract: every route, body, error. |
| [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md)     | The env contract: every var the proxy reads. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                     | One-process Docker / Railway / Fly.io / VPS. |
| [`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md)             | A 90-second walkthrough, with screenshots. |
| [`docs/llms.txt`](docs/llms.txt)                       | Farcaster reference (kept; unused at the moment). |

## See it in action

A three-frame walkthrough with screenshots is in
[`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md). The frames
are: submit a version, curate via the interactive taste-graph
radar, and discover the feed.

## Mechanic (Phase 1 MVP — shipped)

- **Artists** submit a version (audio + metadata). They pay a 0.50 USDC submission fee on **Arc L1**; funds are escrowed.
- **Curators** claim a submission and submit a structured rating (solo intensity 1-10, vocal quality 1-10, energy vs studio, tempo feel, mood tags).
- **N=3 ratings** unlocks publish. The fee pool splits **70 / 20 / 10**: curators (equal share) / platform / MusicBrainz-attributed artist wallet.
- **Discovery** is the feed of published versions, filterable by mood, energy, tempo, solo intensity, and artist.

The whole marketplace runs on **mock-first**: when `ARC_RPC_URL` is missing or unreachable, every settlement call returns a synthesised `tx_hash` and the `mock: true` flag is set on every response. Switching to real Arc is a single config flag — no code changes.

## Quick start

```bash
# 1. Install
npm install

# 2. Run the proxy (defaults to :8080, mock Arc)
node proxy-server.js
#  → /health/live, /health/ready, /api/v1/arc/info, /api/v1/feed, …
#  → /             serves the web client (single-port mode)
#  → migrations auto-apply on boot

# 3. (Optional) Seed the catalog so the Feed tab is alive on first load
npm run seed

# 4. Open http://localhost:8080
```

The web client + API share a single port. In dev, if you prefer the
two-process mode (web on :3000 via `python3 -m http.server`, API on
:8080 via `node proxy-server.js`), the API client auto-detects this
and points the fetch at `http://localhost:8080` instead.

To verify:
```bash
bash scripts/doctor.sh             # env + readiness
bash scripts/test_api.sh           # full E2E smoke (25 assertions)
npm test                          # 54 node:test cases
```

To use real Arc testnet (verified live as of June 2026):

```bash
export ARC_RPC_URL=https://rpc.testnet.arc.network
export ARC_USDC_CONTRACT=0xUSDC…              # ask the Arc team for the testnet USDC
export PLATFORM_WALLET=0xPlat…               # your platform fee recipient
node proxy-server.js
#  → /api/v1/arc/info reports { chainId: "0x4cef52", mock: false }
```

The mock-first policy is still the default: omit `ARC_RPC_URL` and the
proxy generates deterministic tx hashes for every leg, so the entire
demo flow runs end-to-end with zero keys.

## Repository layout

```
/
├── proxy-server.js              # Node entry; runs migrations on boot; thin routes; serves /web/*
├── package.json                 # 3 runtime deps: better-sqlite3, tweetnacl, bs58@5
├── Dockerfile                   # single-process image; see docs/DEPLOYMENT.md
├── railway.toml                 # Railway auto-detects the Dockerfile
├── proxy/
│   ├── runtime/                 # config, http, errors, middleware, validation, cache
│   ├── adapters/                # arc (SettlementProvider), musicbrainz (TTL-cached), audius (legacy, kept for ENHANCEMENT FIRST)
│   ├── services/                # submissions, curation, taste-graph, settlement, feed
│   ├── db.js                    # single sqlite client (WAL, foreign_keys, busy_timeout)
│   ├── migrate.js               # idempotent migration runner
│   └── __tests__/               # 54 node:test cases
├── data/
│   ├── migrations/              # 001_initial, 002_lepton_schema, 003_add_rating_count
│   ├── .gitignore
│   ├── versions.db              # local, gitignored
│   └── uploads/                 # local, gitignored
├── web/                         # 3-tab SPA (Submit / Curate / Feed)
│   ├── index.html
│   ├── app.js                   # ES-module entry; tab + view logic
│   ├── lib/{api,wallet,audio-player,toast,taste-graph}.js
│   └── styles/main.css
├── scripts/
│   ├── doctor.sh                # env + /health/ready + /api/v1/arc/info
│   ├── test_api.sh              # thin wrapper around smoke-day5.js
│   ├── smoke-day3.js            # Day 3 routes
│   ├── smoke-day4.js            # Day 4 routes (publish + settlement legs)
│   ├── smoke-day5.js            # full E2E across Days 3-5
│   └── seed-demo.js             # `npm run seed`: 4 published versions
└── docs/
    ├── LEPTON_STRATEGY.md
    ├── LEPTON_IMPLEMENTATION_PLAN.md
    ├── LEPTON_API.md
    ├── ENVIRONMENT_VARIABLES.md
    ├── DEPLOYMENT.md
    ├── DEMO_WALKTHROUGH.md
    ├── screenshots/             # PNGs for the walkthrough
    └── llms.txt
```

## Deploy

The proxy is a single Node.js process. The web client is served from
the same process at `/`. One port, one process, one volume for the
SQLite database. No external services.

```bash
# Docker (any host)
docker build -t versions:dev .
docker run -d -p 8080:8080 -e PLATFORM_WALLET=0x... -v versions-data:/app/data versions:dev

# Railway
railway up                       # uses railway.toml + Dockerfile

# Fly.io
fly launch && fly deploy

# Bare VPS
# see docs/DEPLOYMENT.md for the full systemd + nginx + certbot recipe
```

`docs/DEPLOYMENT.md` covers all four targets in detail.

## Core Principles (applied to every change)

1. **ENHANCEMENT FIRST** — extend the existing proxy + adapter pattern; never fork a parallel app.
2. **CONSOLIDATION** — delete legacy code; no deprecation warnings, no `_v2` shims.
3. **PREVENT BLOAT** — no feature without a removal that pays for it.
4. **DRY** — one config, one HTTP client, one DB client, one SettlementProvider, one wallet abstraction.
5. **CLEAN** — routes are thin; domain logic in services; services depend only on adapters.
6. **MODULAR** — every adapter has a documented interface; every service is testable without HTTP.
7. **PERFORMANT** — TTL cache, body-size cap, request id, rate limit, paginated feed.
8. **ORGANIZED** — domain folders: `runtime/`, `adapters/`, `services/`.

Every commit footer references which principles it exercises.

## License

Dual-licensed under MIT and GPLv3. See `LICENSE_MIT` and `LICENSE_GPLv3`.

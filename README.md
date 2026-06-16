# ⚛️ VERSIONS — Lepton Submission Marketplace

**Hackathon target:** Lepton Agents (June 15–29, 2026).
**Submission:** See **[`docs/LEPTON_IMPLEMENTATION_PLAN.md`](docs/LEPTON_IMPLEMENTATION_PLAN.md)** for the single build plan and **[`docs/LEPTON_STRATEGY.md`](docs/LEPTON_STRATEGY.md)** for the vision.

This repo is on a single track: the **Lepton Submission Marketplace**. Every doc, script, and code path serves that one goal. Anything that does not is removed.

## Mechanic (Phase 1 MVP)

- **Artists** submit a version (audio + metadata). They pay a USDC submission fee on **Arc L1**; funds are escrowed.
- **Curators** claim a submission and submit a structured rating (solo intensity, vocal quality, energy vs studio, tempo feel, mood tags).
- **N=3 ratings** unlocks publish. The fee pool splits **70 / 20 / 10**: curators (equal share) / platform / MusicBrainz-attributed artist wallet.
- **Discovery** is the feed of published versions, filterable by the taste graph.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Run the placeholder proxy (Day 1 — only /health/live is wired)
node proxy-server.js

# 3. In another terminal, serve the web client
cd web && python3 -m http.server 3000
# open http://localhost:3000
```

The full build sequence (schema → submissions → curation → settlement → UI → tests) lives in `docs/LEPTON_IMPLEMENTATION_PLAN.md`.

## Repository layout

```
/
├── proxy-server.js            # Node entry (Day 1 placeholder; full routes land Day 3)
├── proxy/
│   ├── runtime/               # cross-cutting: config, http, errors, middleware, validation, cache
│   ├── adapters/              # audius.js (kept), arc.js (Day 3), musicbrainz.js (Day 3)
│   └── services/              # submissions, curation, taste-graph, settlement, feed (Day 3–5)
├── data/                      # SQLite at versions.db, uploads/, migrations/ (Day 2)
├── web/                       # entry shell, views, lib, styles (Day 5 rebuild)
├── scripts/                   # doctor.sh (Day 5 rewrite)
└── docs/
    ├── LEPTON_STRATEGY.md
    ├── LEPTON_IMPLEMENTATION_PLAN.md
    └── llms.txt               # Farcaster reference
```

## Core Principles (applied to every change)

1. **ENHANCEMENT FIRST** — extend the existing proxy + adapter pattern; never fork a parallel app.
2. **CONSOLIDATION** — delete legacy code; no deprecation warnings, no `_v2` shims.
3. **PREVENT BLOAT** — no feature without a removal that pays for it.
4. **DRY** — one config, one HTTP client, one DB client, one SettlementProvider, one wallet abstraction.
5. **CLEAN** — routes are thin; domain logic in services; services depend only on adapters.
6. **MODULAR** — every adapter has a documented interface; every service is testable without HTTP.
7. **PERFORMANT** — TTL cache, body-size cap, request id, rate limit, paginated feed.
8. **ORGANIZED** — domain folders: `runtime/`, `adapters/`, `services/`.

## License

Dual-licensed under MIT and GPLv3. See `LICENSE_MIT` and `LICENSE_GPLv3`.

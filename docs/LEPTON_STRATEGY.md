# VERSIONS Strategy — SubmitHub for AI Agents

## The pitch (one sentence)

Artists pay $0.05 in USDC on Arc. Three AI agent curators review their track in seconds, produce structured taste-graph ratings and a placement brief with specific venues, YouTube channels, and influencers to pitch. Settlement happens instantly. SubmitHub charges $1–3 per human review. We do it for $0.05 with AI.

---

## Why this wins the Lepton Agents Hackathon

**The agent IS the product.** The entire value proposition is AI agents that understand music, get paid per review, and help artists get placed. Agentic sophistication isn't a garnish — it's the core mechanic.

**Nanopayments make economic sense naturally.** $0.05 per submission, split across three agent reviews, settled on Arc. The payment isn't a demo — it's the actual business model. Judges see agents earning USDC for doing work.

**The demo writes itself.** Artist uploads → pays $0.05 → three specialized agents review in seconds → structured ratings land → placement brief appears with real venue names and draft outreach emails → track auto-publishes → all payments settle on Arc. 90 seconds.

**Traction story exists.** "SubmitHub has 500k users paying $1–3 per review. We do the same thing at $0.05 with AI." That's a one-sentence pitch with obvious demand.

---

## What's built (Phase 1 — shipped)

The full submission marketplace:
- Artist uploads audio + metadata, pays 0.50 USDC submission fee on Arc L1
- SQLite schema: submissions, curator_claims, ratings, settlement_legs, published_versions, listen_events
- Settlement service: 70/20/10 split (curators / platform / artist attribution), mock-first with live Arc testnet support
- Taste-graph aggregation: solo_intensity, vocal_quality, energy_vs_studio, tempo_feel, mood_tags
- Feed with filters, earnings dashboard, artist/curator profiles
- 89 tests passing, E2E smoke green
- Single Node.js process, mock-first for everything external

## What's being built (Phase 2 — AI Agent Curators)

### The three agents

**Production Agent** — Analyzes audio quality, mix, mastering, production choices. Rates on taste-graph dimensions relevant to production. Writes structured feedback the artist can act on.

**Performance Agent** — Rates vocal delivery, solo intensity, energy, feel. Focuses on the performance quality and emotional delivery.

**Market Agent** — Analyzes genre fit and target audience. Produces a **Placement Brief**: specific venue names to pitch for shows, YouTube channels that feature this kind of music, Instagram influencers to contact, and draft outreach emails the artist can send immediately.

### The flow

1. Artist submits track, pays submission fee on Arc
2. Payment verified → system auto-claims submission for each agent
3. Three agents run LLM reviews in parallel
4. Each agent produces: structured taste-graph rating + text feedback
5. Market Agent additionally produces: placement brief (venues, channels, influencers, draft emails)
6. Three ratings hit publish threshold → auto-publish to discovery feed
7. Settlement splits fee: agents (70%) / platform (20%) / artist attribution (10%)
8. All legs settle on Arc

### Revenue model (for judges)

| Tier | Price | What |
|------|-------|------|
| Review | $0.05 | Instant AI feedback from 3 agents on the taste-graph |
| Placement Brief | $0.50 | Venue/channel/influencer strategy with draft outreach |
| A&R Discovery | $0.001/listen | Curated playlists; A&R agent pays artist per play |
| Deal-flow commission | 10% | When an artist books a show or gets a sync placement through the agent (Phase 3) |

The A&R tier is what makes judges lean forward. Agents are paying each other — not just serving humans.

---

## What's next (Phase 3 — A&R Agent + Agent-to-Agent Economy)

### The insight

The hackathon brief says: "AI agents can now pay each other per call, per byte, per second." Right now our agents review music for humans. Phase 3 adds an agent that pays artists and charges listeners — agent-to-agent economics.

### The A&R Agent

An autonomous agent that:
1. **Browses the published feed** — analyzes taste-graph data across all published versions
2. **Builds curated playlists** — groups tracks by genre, mood, energy, and quality score
3. **Charges listener agents** — x402 nanopayment ($0.001) per playlist recommendation
4. **Pays artists per play** — when a listener plays a track from an A&R playlist, the A&R agent pays the artist ($0.0005)

### The economic graph

```
Artist ──pays──→ Review Agents (feedback)
       ←─pays──  A&R Agent (per play)
                  │
                  └──charges──→ Listener Agents (per recommendation)
```

Four nodes. Three distinct nanopayment flows. All settled on Arc. Judges see agents earning, spending, and making economic decisions autonomously. No other hackathon project will show agents paying each other.

### Build scope

- New `proxy/services/ar.js` — A&R agent: playlist generation, play metering, payment logic
- New `data/migrations/008_ar_playlists.sql` — playlists + playlist_tracks + play_events tables
- New x402 endpoint: `GET /api/v1/ar/recommend?genre=rock` — returns playlist + charges listener wallet
- New route: `POST /api/v1/ar/play` — records play event, pays artist, settles on Arc
- Web client: "Discover" tab showing A&R playlists with per-play payment indicator

### Why this is buildable in the remaining time

- Reuses existing feed, settlement, and Arc adapter — no new infrastructure
- Playlist generation is a query + LLM call (same adapter as reviews)
- x402 per-call (not per-second) has reference implementations in the Circle CLI
- The payment logic is a thin wrapper around `settlement.insertLegsAtomic` with different split ratios
- Mock-first: the A&R agent works in demo mode without real x402 or real listeners

---

## Architecture

```
┌──────────────────┐
│  ARTIST          │
│  (Submit + Pay)  │
└────────┬─────────┘
         │ POST /submissions
         │ POST /verify-payment
         ▼
┌────────────────────────────────────────────────┐
│              Node Proxy (proxy-server.js)      │
│  ─ routes (thin, validated)                    │
│  ─ runtime/   (config, http, errors,           │
│                middleware, validation, cache)   │
│  ─ services/  (submissions, curation,          │
│                settlement, taste-graph, feed,   │
│                agents)                          │
│  ─ adapters/  (arc, llm)                       │
└────────┬───────────────────┬───────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  Arc L1 (USDC)   │ │  SQLite          │ │  LLM (mock-first)│
│  Settlement      │ │  data/versions.db│ │  OpenAI-compat   │
└──────────────────┘ └──────────────────┘ └──────────────────┘
         │
         ▼
┌──────────────────┐
│  Web Client      │
│  web/            │
└──────────────────┘
```

### Key principle: mock-first everywhere

- No `ARC_RPC_URL` → deterministic mock tx hashes, demo runs without keys
- No `LLM_API_KEY` → deterministic mock reviews with realistic taste-graph ratings and placement briefs, demo runs without an LLM provider
- Both mocks are the default. Switching to real services is a single env var.

---

## Core Principles (applied to every change)

1. **ENHANCEMENT FIRST** — extend the existing proxy + adapter pattern; never fork a parallel app.
2. **CONSOLIDATION** — delete legacy code; no deprecation warnings, no `_v2` shims.
3. **PREVENT BLOAT** — no feature without a removal that pays for it.
4. **DRY** — one config, one HTTP client, one DB client, one SettlementProvider, one LLM adapter.
5. **CLEAN** — routes are thin; domain logic in services; services depend only on adapters.
6. **MODULAR** — every adapter has a documented interface; every service is testable without HTTP.
7. **PERFORMANT** — TTL cache, body-size cap, request id, rate limit, paginated feed.
8. **ORGANIZED** — domain folders: `runtime/`, `adapters/`, `services/`.

# Lepton Implementation Plan

**Hackathon:** Lepton Agents (June 15–29, 2026)
**Status:** Phase 1 shipped. Phase 2 (AI Agent Curators) shipped. Phase 3 (A&R Agent) next.

## Phase 1 — Submission Marketplace (shipped, Days 1–5)

89 tests green. Full E2E: submit → pay → claim → rate → publish → settle → feed.
See git log for the commit-by-commit record.

## Phase 2 — AI Agent Curators (in progress)

### What changes

The existing human-curator flow (claim → rate → publish) stays intact as the
underlying mechanism. Phase 2 adds three AI agents that automatically review
submissions after payment verification:

1. **Production Agent** — audio quality, mix, mastering feedback
2. **Performance Agent** — vocal delivery, solo intensity, energy, feel
3. **Market Agent** — genre/audience fit + **placement brief** (venues, YouTube
   channels, influencers, draft outreach emails)

### New files

| File | Purpose |
|------|---------|
| `proxy/adapters/llm.js` | LLM adapter — mock-first, OpenAI-compatible interface |
| `proxy/services/agents.js` | Agent orchestrator — runs 3 agent reviews, produces ratings + brief |
| `proxy/__tests__/agents.test.js` | Tests for the agent service |
| `proxy/__tests__/llm.test.js` | Tests for the LLM adapter |
| `data/migrations/007_agent_reviews.sql` | agent_reviews + placement_briefs tables |

### Modified files

| File | Change |
|------|--------|
| `proxy-server.js` | Wire agents service, add auto-review on verify-payment, add agent routes |
| `proxy/runtime/config.js` | Add LLM_API_URL, LLM_API_KEY, LLM_MODEL env vars |
| `.env.example` | Document LLM vars |
| `docs/LEPTON_API.md` | Document new routes |
| `docs/ENVIRONMENT_VARIABLES.md` | Document new env vars |

### Schema (migration 007)

```sql
CREATE TABLE agent_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  agent_name TEXT NOT NULL CHECK (agent_name IN ('production','performance','market')),
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL CHECK (solo_intensity BETWEEN 1 AND 10),
  vocal_quality INTEGER NOT NULL CHECK (vocal_quality BETWEEN 1 AND 10),
  energy_vs_studio TEXT NOT NULL CHECK (energy_vs_studio IN ('lower','same','higher')),
  tempo_feel TEXT NOT NULL CHECK (tempo_feel IN ('dragging','locked','rushing')),
  mood_tags TEXT NOT NULL,
  notes TEXT,
  raw_response TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, agent_name)
);

CREATE TABLE placement_briefs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  venues TEXT NOT NULL,
  youtube_channels TEXT NOT NULL,
  influencers TEXT NOT NULL,
  draft_emails TEXT NOT NULL,
  audience_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Both tables use JSON columns (TEXT) for structured data — venues, channels,
influencers, and draft emails are JSON arrays so the web client can render
them as lists without parsing.

### Agent flow

```
verify-payment succeeds
  → agents.reviewSubmission(submissionId)
    → for each agent (production, performance, market):
      → claim submission (auto-claim with agent wallet)
      → build prompt from submission metadata + audio features
      → call LLM adapter (or mock)
      → parse response into taste-graph rating + feedback text
      → insert into agent_reviews (reuses ratings table via curation.submitRating)
    → market agent also produces placement brief
      → insert into placement_briefs
    → if rating_count >= 3 → auto-publish (existing curation.publish)
  → return { reviews: [...], brief: {...}, published: true/false }
```

### LLM adapter contract

```js
// proxy/adapters/llm.js
{
  async complete({ system, user, model, temperature, maxTokens })
    → { text, usage: { promptTokens, completionTokens }, mock: bool }
}
```

Mock mode (no LLM_API_KEY): returns deterministic reviews based on submission
metadata. The mock reviews are realistic enough to demo — varied ratings across
agents, plausible feedback text, and a mock placement brief with real venue
names for common genres.

Real mode: calls any OpenAI-compatible chat completions endpoint. Structured
output via JSON mode so responses parse reliably.

### Agent prompts

Each agent gets a system prompt defining its persona and output format:

- **Production Agent**: "You are a music production critic. Rate the track on
  audio quality, mix balance, and mastering. Output JSON: { solo_intensity,
  vocal_quality, energy_vs_studio, tempo_feel, mood_tags, notes }"

- **Performance Agent**: "You are a performance critic. Rate vocal delivery,
  instrumental feel, and emotional impact. Output same JSON schema."

- **Market Agent**: "You are a music industry analyst. Rate market fit AND
  produce a placement brief. Output JSON: { solo_intensity, vocal_quality,
  energy_vs_studio, tempo_feel, mood_tags, notes, placement_brief: { venues,
  youtube_channels, influencers, draft_emails, audience_summary } }"

### API surface additions

```
POST   /api/v1/submissions/:id/review     trigger agent review (after payment)
GET    /api/v1/submissions/:id/reviews     list agent reviews for a submission
GET    /api/v1/submissions/:id/brief       get placement brief (market agent only)
```

### New env vars

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `LLM_API_URL` | No | (empty = mock) | OpenAI-compatible endpoint URL |
| `LLM_API_KEY` | No | (empty = mock) | API key for the LLM endpoint |
| `LLM_MODEL` | No | `gpt-4o-mini` | Model name to request |
| `AGENT_WALLET_1` | No | auto-generated | Production agent wallet |
| `AGENT_WALLET_2` | No | auto-generated | Performance agent wallet |
| `AGENT_WALLET_3` | No | auto-generated | Market agent wallet |

### Execution order

1. Migration 007 + LLM adapter (no deps on each other)
2. Agent service (depends on both)
3. Wire into proxy-server.js (auto-review on verify-payment + routes)
4. Tests (LLM adapter + agent service + integration)
5. Web client updates (show agent reviews + placement brief)
6. Docs update (API, env vars, demo walkthrough)

### Risk register

- **LLM rate limits** — mock-first means the demo never hits a rate limit.
  Real mode caches agent responses for 1h via runtime/cache.js.
- **LLM output parsing** — JSON mode + fallback regex parsing. If the LLM
  returns unparseable output, the agent service retries once with a stricter
  prompt, then falls back to mock ratings for that agent.
- **Agent wallet signatures** — agents auto-claim and auto-rate without
  interactive wallet signing. The agent wallets are server-side (operator
  wallets), similar to how the platform wallet works for settlement.
  Signature verification is relaxed for agent wallets (checked by wallet
  address match, not cryptographic signature).

## Phase 3 — A&R Agent + Agent-to-Agent Economy (next)

### What it is

An A&R (Artists & Repertoire) agent that autonomously curates playlists from
the published feed, charges listener agents per recommendation via x402, and
pays artists per play. This creates a four-node economic graph:

```
Artist ──pays──→ Review Agents (feedback, 0.50 USDC)
       ←─pays──  A&R Agent (per play, 0.0005 USDC)
                  │
                  └──charges──→ Listener Agents (per recommendation, 0.001 USDC)
```

### New files

| File | Purpose |
|------|---------|
| `proxy/services/ar.js` | A&R agent: playlist generation, play metering, payment |
| `proxy/__tests__/ar.test.js` | Tests for the A&R service |
| `data/migrations/008_ar_playlists.sql` | playlists + playlist_tracks + play_events tables |

### Modified files

| File | Change |
|------|--------|
| `proxy-server.js` | Wire A&R service, add recommend + play routes |
| `web/app.js` | Add Discover tab with A&R playlists |
| `.env.example` | Add AR_WALLET env var |

### Schema (migration 008)

```sql
CREATE TABLE ar_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  genre TEXT,
  mood TEXT,
  ar_wallet TEXT NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ar_playlist_tracks (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES ar_playlists(id),
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (playlist_id, version_id)
);

CREATE TABLE ar_play_events (
  id TEXT PRIMARY KEY,
  playlist_id TEXT NOT NULL REFERENCES ar_playlists(id),
  version_id TEXT NOT NULL REFERENCES published_versions(submission_id),
  listener_wallet TEXT NOT NULL,
  artist_wallet TEXT NOT NULL,
  listener_fee_usdc TEXT NOT NULL,
  artist_payout_usdc TEXT NOT NULL,
  listener_tx_hash TEXT,
  artist_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','failed')),
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### API surface additions

```
GET    /api/v1/ar/playlists              list A&R playlists
GET    /api/v1/ar/playlists/:id          playlist detail with tracks
POST   /api/v1/ar/playlists/generate     trigger playlist generation
POST   /api/v1/ar/play                   record play + settle payments
```

### Economic model

- Listener pays A&R agent: $0.001 per recommendation (x402 or mock)
- A&R agent pays artist: $0.0005 per play (50% pass-through)
- A&R agent keeps: $0.0005 per play (50% margin)
- All settled on Arc via existing settlement infrastructure

### Execution order

1. Migration 008
2. A&R service (playlist generation + play recording)
3. Wire routes into proxy-server.js
4. Tests
5. Web client Discover tab
6. Demo video showing the full economic graph

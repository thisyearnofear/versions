# ⚛️ Lepton Submission Marketplace — Implementation Plan

**Status:** Active build. This is the only plan.
**Hackathon:** Lepton Agents (June 15–29, 2026)
**Submission target:** Lepton track.

> All other historical docs (HACKATHON_SUBMISSION, ELEVENHACKS_IMPLEMENTATION_PLAN,
> USER_FLOW, USER_GUIDE, DEPLOYMENT_GUIDE, DEVELOPER_GUIDE, DEMO_SCRIPT,
> ARTIST_GUIDE, ENVIRONMENT_VARIABLES) are legacy and have been removed in
> Day 1. They do not describe the shipped product. Do not revive them.

---

## Core Principles (verbatim, applied to every task below)

1. **ENHANCEMENT FIRST** — extend the existing proxy + audit-runtime + adapter
   pattern; never fork a parallel app.
2. **CONSOLIDATION** — delete legacy code and docs; no deprecation warnings,
   no `_v2` shims.
3. **PREVENT BLOAT** — no feature without a removal that pays for it.
4. **DRY** — one config module, one HTTP client, one DB client, one
   SettlementProvider, one wallet abstraction.
5. **CLEAN** — routes are thin; all domain logic lives in `services/`;
   services depend only on adapters, never on Express.
6. **MODULAR** — every adapter implements a documented interface; every
   service is callable from a unit test without HTTP.
7. **PERFORMANT** — TTL cache, body-size cap, request id, rate limit on
   write paths, paginated feed.
8. **ORGANIZED** — domain folders: `runtime/`, `adapters/`, `services/`,
   `routes/` (or inline in `proxy-server.js` until routes multiply).

If a task cannot be tied to ≥1 of the above, it does not ship.

---

## End-State Architecture

```
┌──────────────────┐         ┌──────────────────┐
│  ARTIST          │         │  CURATOR         │
│  (Submit)        │         │  (Rate)          │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │ POST /submissions          │ POST /claim, /rate
         │ POST /arc/verify-payment   │
         ▼                            ▼
┌────────────────────────────────────────────────┐
│              Node Proxy (proxy-server.js)      │
│  ─ routes (thin, validated)                    │
│  ─ runtime/   (config, http, errors,           │
│                middleware, validation, cache)   │
│  ─ services/  (submissions, curation,          │
│                settlement, taste-graph, feed)   │
│  ─ adapters/  (arc, musicbrainz, audius)       │
└────────┬───────────────────────────┬───────────┘
         │                           │
         ▼                           ▼
┌──────────────────┐         ┌──────────────────┐
│  Arc L1 (USDC)   │         │  SQLite          │
│  Settlement      │         │  data/versions.db│
└──────────────────┘         └──────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  Web Client      │
                              │  web/            │
                              └──────────────────┘
```

### File layout (target)

```
/Users/udingethe/Dev/versions/
├── package.json                       # one and only build manifest
├── .env / .env.example
├── proxy-server.js                    # entry + routes
├── proxy/
│   ├── runtime/
│   │   ├── config.js                  # existing — keep
│   │   ├── http.js                    # existing — keep
│   │   ├── errors.js                  # existing — keep
│   │   ├── middleware.js              # existing — keep
│   │   ├── validation.js              # existing — extend
│   │   └── cache.js                   # existing — keep
│   ├── adapters/
│   │   ├── audius.js                  # keep (artist track lookup)
│   │   ├── arc.js                     # NEW — SettlementProvider
│   │   └── musicbrainz.js             # NEW — MBID lookup
│   ├── services/
│   │   ├── submissions.js             # NEW
│   │   ├── curation.js                # NEW
│   │   ├── taste-graph.js             # NEW
│   │   ├── settlement.js              # NEW
│   │   └── feed.js                    # NEW
│   ├── db.js                          # NEW — single sqlite client
│   ├── migrate.js                     # NEW — idempotent migration runner
│   └── __tests__/                     # NEW — node:test
│       ├── arc.test.js
│       ├── submissions.test.js
│       ├── curation.test.js
│       └── settlement.test.js
├── data/
│   ├── migrations/
│   │   ├── 001_initial.sql            # NEW (replaces hand-rolled initDb)
│   │   └── 002_lepton_schema.sql      # NEW
│   ├── versions.db                    # gitignored
│   └── uploads/                       # gitignored
├── web/
│   ├── index.html                     # REWRITE — entry shell
│   ├── app.js                         # NEW — extracted main app
│   ├── views/
│   │   ├── artist.html                # NEW — submission form
│   │   ├── curator.html               # NEW — queue + rating form
│   │   └── feed.html                  # NEW — discovery
│   ├── lib/
│   │   ├── api.js                     # rename of api-client.js
│   │   ├── wallet.js                  # NEW — Phantom + Arc
│   │   ├── audio-player.js            # NEW
│   │   └── toast.js                   # NEW
│   └── styles/
│       └── main.css                   # extracted
├── scripts/
│   ├── doctor.sh                      # rewrite env list
│   ├── start-demo.sh                  # rewrite for Node-only
│   └── test_api.sh                    # rewrite for Lepton endpoints
└── docs/
    ├── LEPTON_STRATEGY.md             # keep (the vision)
    ├── LEPTON_IMPLEMENTATION_PLAN.md  # this file
    ├── LEPTON_API.md                  # NEW
    ├── ENVIRONMENT_VARIABLES.md       # rewrite
    └── llms.txt                       # keep (Farcaster reference)
```

### Removed (Day 1)

```
# Rust workspace — gone
Cargo.toml, lib/, playback/, server/, Makefile, clippy.toml
scripts/verify_build.sh, scripts/test_server.sh, scripts/build_termusic.sh

# Audio Lab — gone
proxy/adapters/elevenlabs.js
proxy/adapters/turbopuffer.js
proxy/services/audio-compose.js
scripts/ingest.js

# Stale web glue — gone
web/audius-solana.js
web/theme-bridge.js
web/farcaster-miniapp.js
web/wasm/*

# Stale docs — gone
docs/HACKATHON_SUBMISSION.md
docs/USER_FLOW.md
docs/USER_GUIDE.md
docs/DEPLOYMENT_GUIDE.md
docs/DEVELOPER_GUIDE.md
docs/DEMO_SCRIPT.md
docs/ELEVENHACKS_IMPLEMENTATION_PLAN.md
docs/ARTIST_GUIDE.md
docs/ENVIRONMENT_VARIABLES.md        # rewritten Day 5
```

### Principles applied to the file layout

- **ENHANCEMENT FIRST**: `runtime/`, `db.js`, and `audius.js` are reused; no
  parallel framework.
- **CONSOLIDATION**: every Audio Lab file is removed in Day 1; the Rust
  workspace is removed in Day 1.
- **DRY**: one `db.js`, one `migrate.js`, one `validation.js`, one
  `SettlementProvider` interface (in `adapters/arc.js`).
- **CLEAN**: `proxy-server.js` registers routes; routes call services;
  services call adapters; adapters wrap the network.
- **ORGANIZED**: domain folders map directly to the architecture diagram.

---

## Schema (frozen at end of Day 2)

```sql
-- 001_initial.sql
CREATE TABLE _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 002_lepton_schema.sql
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  artist_wallet TEXT NOT NULL,
  audius_track_id TEXT,
  musicbrainz_id TEXT,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL CHECK (version_type IN
    ('demo','live','acoustic','remix','remaster','studio','other')),
  genre TEXT,
  artist_mood TEXT,
  description TEXT,
  audio_path TEXT NOT NULL,
  audio_duration_seconds INTEGER,
  audio_size_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  fee_quote_usdc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','awaiting_curation','in_curation',
                      'published','rejected')),
  payment_tx_hash TEXT,
  payment_verified_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX idx_submissions_status ON submissions(status, submitted_at DESC);
CREATE INDEX idx_submissions_artist ON submissions(artist_wallet);

CREATE TABLE curator_claims (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  curator_wallet TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (submission_id, curator_wallet)
);
CREATE INDEX idx_claims_submission ON curator_claims(submission_id);

CREATE TABLE ratings (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL CHECK (solo_intensity BETWEEN 1 AND 10),
  vocal_quality INTEGER NOT NULL CHECK (vocal_quality BETWEEN 1 AND 10),
  energy_vs_studio TEXT NOT NULL
    CHECK (energy_vs_studio IN ('lower','same','higher')),
  tempo_feel TEXT NOT NULL
    CHECK (tempo_feel IN ('dragging','locked','rushing')),
  mood_tags TEXT NOT NULL,    -- JSON array of strings
  notes TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, curator_wallet)
);
CREATE INDEX idx_ratings_submission ON ratings(submission_id);

CREATE TABLE settlement_legs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  recipient_wallet TEXT NOT NULL,
  recipient_role TEXT NOT NULL
    CHECK (recipient_role IN ('curator','platform','musicbrainz')),
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT,
  settled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','settled','failed'))
);
CREATE INDEX idx_settlement_submission ON settlement_legs(submission_id);

CREATE TABLE published_versions (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  artist_wallet TEXT NOT NULL,
  title TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  version_type TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  musicbrainz_id TEXT,
  avg_solo_intensity REAL,
  avg_vocal_quality REAL,
  energy_consensus TEXT,
  tempo_consensus TEXT,
  aggregated_mood_tags TEXT,    -- JSON array
  rating_count INTEGER NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX idx_published_at ON published_versions(published_at DESC);
```

**Tunable constants** (in `proxy/runtime/config.js`):

```js
PUBLISH_THRESHOLD_RATINGS = 3
SUBMISSION_FEE_USDC       = '0.50'
CURATOR_PAYOUT_SHARE      = 0.70
PLATFORM_FEE_SHARE        = 0.20
MUSICBRAINZ_SHARE         = 0.10
CLAIM_TTL_HOURS           = 24
```

**Taste-graph aggregation** (in `services/taste-graph.js`):

- `avg_solo_intensity`, `avg_vocal_quality`: simple mean.
- `energy_consensus`, `tempo_consensus`: plurality; ties broken alphabetically
  (deterministic, DRY).
- `aggregated_mood_tags`: union of all mood tags from all ratings, sorted,
  deduped.

---

## API surface (frozen at end of Day 5)

```
POST   /api/v1/submissions                create submission (multipart)
GET    /api/v1/submissions/queue          curator queue
GET    /api/v1/submissions/:id            status + ratings + legs
POST   /api/v1/submissions/:id/claim      curator claims
DELETE /api/v1/submissions/:id/claim      curator releases
POST   /api/v1/submissions/:id/rate       submit structured rating
POST   /api/v1/submissions/:id/verify-payment  confirm Arc tx hash
GET    /api/v1/feed                       published versions (paginated)
GET    /api/v1/versions/:id               full version + taste graph
GET    /api/v1/curators/:wallet           curator profile + earnings
GET    /api/v1/artists/:wallet            artist profile + earnings
GET    /api/v1/arc/info                   chain + USDC contract
GET    /api/v1/health/live
GET    /api/v1/health/ready
```

Full reference in `docs/LEPTON_API.md` (written Day 5).

---

## Settlement contract (the SOT for money)

`adapters/arc.js` exports a single object implementing:

```js
{
  async getInfo(),                                  // chain id, usdc contract
  async quoteTransfer({ from, to, amountUsdc }),    // gas estimate
  async getTransaction(txHash),                     // status + confirmations
  async waitForFinality(txHash, { timeoutMs })      // polls getTransaction
}
```

**Mock-first policy** (`PERFORMANT` + `PREVENT BLOAT`):
- If `ARC_RPC_URL` is unreachable, fall back to a deterministic mock that
  synthesises a tx hash from `${recipient}:${amount}:${nonce}` and marks
  legs `settled` after a 500ms delay.
- This is the only place mock-fallback is allowed; every other adapter must
  hard-fail on misconfiguration.

**Settlement flow** (called from `services/curation.js` when a rating
crosses the publish threshold):

1. `settlement.splitFee(submission)` returns 3–N legs:
   - `curator` legs: one per distinct curator wallet that rated, amount
     `fee * 0.70 / rating_count`
   - `platform` leg: `fee * 0.20`
   - `musicbrainz` leg: `fee * 0.10` (recipient = artist's wallet when
     `musicbrainz_id` resolves to a wallet, else platform fallback)
2. Insert legs into `settlement_legs` (`status='pending'`).
3. For each leg, call `arc.quoteTransfer` then `arc.sendTransfer` (or
   record the mock).
4. Update leg with `tx_hash`, `settled_at`, `status`.

The settlement service is the **only** writer of `settlement_legs`. This
keeps the on-chain ledger auditable in one place.

---

## Wallet abstraction (the SOT for keys)

`web/lib/wallet.js` exposes:

```js
connect()                  // Phantom; throws if missing
getAddress()               // base58
signMessage(text)          // for ownership proof on submission
arcSendTransfer({ to, amountUsdc })  // returns tx hash
```

All Phantom-specific code lives here. Routes and services do not import
`@solana/web3.js` directly.

---

## 5-day execution plan

Each day ends with explicit exit criteria and a tag of which Principles it
exercises. Days are sequential, not parallel, because the schema is the
foundation for everything.

### Day 1 — Cleanup (CONSOLIDATION + PREVENT BLOAT)

Tasks:
1. Delete the Rust workspace: `Cargo.toml`, `lib/`, `playback/`, `server/`,
   `Makefile`, `clippy.toml`, `scripts/verify_build.sh`,
   `scripts/test_server.sh`, `scripts/build_termusic.sh`.
2. Delete Audio Lab code: `proxy/adapters/elevenlabs.js`,
   `proxy/adapters/turbopuffer.js`, `proxy/services/audio-compose.js`,
   `scripts/ingest.js`.
3. Delete stale web glue: `web/audius-solana.js`, `web/theme-bridge.js`,
   `web/farcaster-miniapp.js`, `web/wasm/*`.
4. Delete stale docs: `HACKATHON_SUBMISSION.md`, `USER_FLOW.md`,
   `USER_GUIDE.md`, `DEPLOYMENT_GUIDE.md`, `DEVELOPER_GUIDE.md`,
   `DEMO_SCRIPT.md`, `ELEVENHACKS_IMPLEMENTATION_PLAN.md`,
   `ARTIST_GUIDE.md`, `ENVIRONMENT_VARIABLES.md` (last one gets a clean
   replacement on Day 5).
5. Strip `proxy-server.js` to a placeholder: just `/health/live` returning
   `{"status":"ok","service":"lepton-proxy"}` and a `console.log("Lepton
   MVP booting…")`. Every Audio Lab route is removed in this commit.
6. Reduce `web/index.html` to a one-page placeholder: "Lepton Submission
   Marketplace — coming online."
7. Update root `README.md` to point only at this plan and `LEPTON_STRATEGY.md`.
   Remove every Audio Lab / TUI / Termusic reference.
8. Run `git grep -l "audio.lab\|elevenlabs\|turbopuffer\|termusic\|versions-tui"`
   and fix any survivors.

Exit criteria:
- `ls` shows no Rust, no Audio Lab, no stale web glue.
- `node proxy-server.js` boots and serves `/health/live` only.
- `git grep` for the terms above returns zero matches in `proxy/`, `web/`,
  `docs/`, `scripts/`.
- The 4 surviving docs are: `LEPTON_STRATEGY.md`, this plan, `llms.txt`,
  and a stub `ENVIRONMENT_VARIABLES.md` ("see Day 5").

Principle tags: `CONSOLIDATION`, `PREVENT BLOAT`, `CLEAN` (single
responsibility per remaining file).

### Day 2 — Schema + DB client + migrations (DRY + ORGANIZED)

Tasks:
1. Create `proxy/db.js` exporting a single `openDb()` that returns a shared
   `better-sqlite3` instance, with the WAL pragma and foreign keys on.
2. Create `proxy/migrate.js` that:
   - reads `data/migrations/*.sql` in lex order
   - tracks applied names in `_migrations`
   - applies missing files in a single transaction per file
   - is idempotent (re-runs are no-ops)
3. Add a `migrate` script to `package.json`: `node proxy/migrate.js`.
4. Wire `proxy/migrate.js()` to run at the top of `proxy-server.js` before
   the server starts listening.
5. Add `data/migrations/001_initial.sql` (just `_migrations` table) and
   `data/migrations/002_lepton_schema.sql` (the five tables above).
6. Add `data/.gitignore` with `versions.db`, `uploads/`, `uploads/*`.
7. Delete the hand-rolled `CREATE TABLE IF NOT EXISTS track_relationships
   / version_metadata` from the old `initDb()` in `proxy-server.js`.
8. Add `better-sqlite3` to `package.json` dependencies; remove unused
   `sqlite` / `sqlite3` if no longer used.

Exit criteria:
- Fresh `data/versions.db` is created by `npm run migrate` with all five
  Lepton tables and zero legacy tables.
- Idempotent re-runs do not duplicate tables.
- `node proxy-server.js` boots in < 1s, applies migrations, then starts
  the HTTP listener.

Principle tags: `DRY` (one DB client), `ORGANIZED` (migrations folder
maps to schema), `CLEAN` (no business logic in `proxy-server.js`).

### Day 3 — Submissions + Arc + MusicBrainz (ENHANCEMENT FIRST + MODULAR)

Tasks:
1. Implement `proxy/adapters/arc.js`:
   - `getInfo()`, `getTransaction(hash)`, `quoteTransfer()`,
     `sendTransfer()`, `waitForFinality()`.
   - Mock-first fallback (deterministic tx hash) when `ARC_RPC_URL`
     unreachable.
   - Uses the same `runtime/http.js` timeout + retry + request-id plumbing
     as the other adapters.
2. Implement `proxy/adapters/musicbrainz.js`:
   - `getRecording(mbid)`, `getArtist(mbid)`, `resolveArtistWallet(mbid)`.
   - TTL-cached via `runtime/cache.js` (24h TTL).
   - Resolves to a wallet address via the existing `audius.js` artist
     lookup (ENHANCEMENT FIRST) — if the MBID is also indexed on Audius,
     use that wallet; else null (settlement falls back to platform).
3. Implement `proxy/services/submissions.js`:
   - `createSubmission({ audioBuffer, metadata, artistWallet, signature })`
     — verifies the artist owns `artistWallet` by checking
     `signMessage("VERSIONS_LEPTON_SUBMIT")` matches the address, then
     inserts the row with `status='pending_payment'`, returns
     `{ id, fee_quote_usdc, payment_address }`.
   - `getSubmission(id)`, `listQueue({ limit, offset })`,
     `verifyPayment(id, txHash)` — flips to `awaiting_curation` on a
     successful `arc.getTransaction` with the right `to` + `amount`.
4. Extend `proxy/runtime/validation.js` with a `validateSubmissionMetadata`
   helper and `validateArcTxHash` helper (DRY).
5. Add `data/uploads/` directory + express body limit raised to 50mb for
   `POST /submissions`. Use `multer` (or built-in `express.raw` with a
   content-type guard) — pick the smaller one and document the choice in
   the file header.
6. Add the routes to `proxy-server.js`:
   - `POST /api/v1/submissions` (multipart)
   - `GET  /api/v1/submissions/queue`
   - `GET  /api/v1/submissions/:id`
   - `POST /api/v1/submissions/:id/verify-payment`
   - `GET  /api/v1/arc/info`
   - `GET  /api/v1/uploads/:filename` (auth-gated; only the submitting
     artist or any claimed curator may stream)
7. Add a `node:test` file `proxy/__tests__/submissions.test.js` covering:
   happy path, missing audio, oversized audio, invalid signature, bad
   MBID, payment-verification failure.

Exit criteria:
- An artist can submit an mp3, get a fee quote, and a settlement address.
- `verify-payment` flips status to `awaiting_curation`.
- Mock Arc works end-to-end without keys; real Arc works when `ARC_RPC_URL`
  is set.
- All Day 3 routes return correct 4xx with the standard error envelope.

Principle tags: `ENHANCEMENT FIRST` (reuse `runtime/http.js`,
`runtime/validation.js`, `runtime/cache.js`, `audius.js`),
`MODULAR` (every adapter is mockable), `PERFORMANT` (request id + timeout
+ cache).

### Day 4 — Curation + ratings + publish gate (CLEAN + MODULAR)

Tasks:
1. Implement `proxy/services/curation.js`:
   - `claimSubmission(id, curatorWallet, signature)` — atomic insert into
     `curator_claims` with a 24h `expires_at`. Rejects if the curator is
     also the artist, if the submission is not `awaiting_curation` /
     `in_curation`, or if a non-expired claim exists.
   - `releaseClaim(id, curatorWallet)` — sets `released_at`.
   - `submitRating(id, curatorWallet, rating, signature)` — validates
     against an active claim, inserts the row, increments
     `submissions.rating_count`, and if `rating_count >= PUBLISH_THRESHOLD`
     calls `publishSubmission(id)` (see below).
   - `publishSubmission(id)` — single transaction: aggregates taste graph
     via `taste-graph.js`, inserts `published_versions` row, flips
     submission to `published`, calls `settlement.splitFee(id)`.
2. Implement `proxy/services/taste-graph.js`:
   - `aggregate(submissionId)` — returns the denormalised row to insert
     into `published_versions`. Pure function, no DB writes; called from
     `curation.publishSubmission`.
3. Add the routes to `proxy-server.js`:
   - `POST   /api/v1/submissions/:id/claim`
   - `DELETE /api/v1/submissions/:id/claim`
   - `POST   /api/v1/submissions/:id/rate`
   - `GET    /api/v1/curators/:wallet`  (count of ratings, total earned
     from settled legs)
   - `GET    /api/v1/artists/:wallet`   (count of submissions, total
     received from settled legs)
4. Add `node:test` file `proxy/__tests__/curation.test.js` covering:
   claim by artist is rejected; claim without signature is rejected;
   rate without claim is rejected; publish threshold triggers at 3;
   taste-graph consensus is deterministic on ties.

Exit criteria:
- 3 curators can claim, rate, and publish a submission in sequence.
- `published_versions` is populated with the agreed consensus.
- The publish transaction is atomic — a failure in settlement rolls back
  the publish.

Principle tags: `CLEAN` (services own the rules, routes own the wire),
`MODULAR` (publish is a single function with no side-effect outside the
transaction), `PERFORMANT` (consensus computed once per publish, not per
read).

### Day 5 — Settlement, feed, UI, tests, doctor (PERFORMANT + DRY)

Tasks:
1. Implement `proxy/services/settlement.js`:
   - `splitFee(submissionId)` — generates the legs per the Settlement
     contract above, inserts them, then calls `arc.quoteTransfer` +
     `arc.sendTransfer` for each (or the mock). Updates `tx_hash`,
     `settled_at`, `status`. Wraps the whole sequence in a transaction
     so partial failure is recoverable.
   - `getSubmissionLedger(submissionId)` — used by the version detail
     endpoint to show the artist + curators that the funds actually moved.
2. Implement `proxy/services/feed.js`:
   - `listPublished({ limit, offset, filter })` — reads
     `published_versions` with optional mood/energy/solo filters and
     paginates. Sort by `published_at DESC` by default.
   - `getVersion(id)` — joins `published_versions` + `settlement_legs` for
     the version detail page.
3. Add the routes to `proxy-server.js`:
   - `GET /api/v1/feed`
   - `GET /api/v1/versions/:id`
4. Rebuild the web client:
   - `web/index.html` — entry shell with three tabs (Artist / Curator /
     Feed).
   - `web/views/artist.html`, `web/views/curator.html`, `web/views/feed.html`
     — each ~200 lines, no inline `<script>` blocks (ENHANCEMENT FIRST
     on the modular pattern).
   - `web/lib/wallet.js` — Phantom + Arc helpers (the only place
     `@solana/web3.js` is imported on the client).
   - `web/lib/api.js` — rename of `api-client.js`, exported as ES module.
   - `web/lib/audio-player.js` — wraps `<audio>` with simple play/pause/seek.
   - `web/lib/toast.js` — single toast component, replaces all the inline
     notification code that was scattered through `index.html`.
   - `web/styles/main.css` — extracted from inline `<style>`.
   - `web/artist.html` from the legacy tree is removed; replaced by the
     `views/artist.html` partial.
5. Rewrite `scripts/doctor.sh` env-var list to:
   - Required: `ARC_RPC_URL`, `ARC_USDC_CONTRACT`, `PLATFORM_WALLET`.
   - Optional: `HF_API_TOKEN` (only if MusicBrainz→HF enrichment is on),
     `AUDIUS_API_KEY`, `MOCK_ARC=1` (forces mock even when RPC is up).
   - HTTP checks: `/health/live`, `/health/ready`, `/arc/info`.
6. Rewrite `scripts/test_api.sh` to hit every Lepton endpoint with a known
   fixture (an mp3 committed at `data/fixtures/sample.mp3`).
7. Write `docs/LEPTON_API.md` — one entry per route, with curl example and
   the response shape. Single source of truth for the wire contract.
8. Rewrite `docs/ENVIRONMENT_VARIABLES.md` — table of every var
   `runtime/config.js` reads, with required/optional, default, and a
   one-line description.
9. Add `proxy/__tests__/settlement.test.js` and
   `proxy/__tests__/feed.test.js` covering the 70/20/10 split, leg
   dedupe, mock-arc determinism, and feed pagination.
10. Add `npm test` to `package.json` running `node --test
    proxy/__tests__/*.test.js`.

Exit criteria:
- E2E demo path works: artist submits → mock-arc verifies payment → 3
  curators rate → submission publishes → settlement legs are recorded →
  feed shows the version → artist and curator endpoints report
  consistent earnings.
- `bash scripts/doctor.sh` green.
- `bash scripts/test_api.sh` green.
- `npm test` green.
- `web/` is < 200 lines per file, no inline `<script>`, no inline
  `<style>` blocks beyond a single reset.

Principle tags: `PERFORMANT` (feed is paginated + filterable, settlement
is bounded by tx timeout), `DRY` (one `LEPTON_API.md`, one
`ENVIRONMENT_VARIABLES.md`), `CLEAN` (settlement is a single service,
web partials are leaf-level), `MODULAR` (settlement is testable without
Arc by passing a fake adapter).

---

## Risk register

- **Arc L1 public testnet reachability** — Mitigated by mock-first
  policy. The swap to real Arc is one config flag.
- **Phantom deep-link to Arc L1** — depends on Phantom shipping Arc
  support in time. If not, fall back to a Phantom sign-and-broadcast
  pattern with `@solana/web3.js` on the client; the `wallet.js` module
  absorbs the difference.
- **Audio storage** — `data/uploads/` is a filesystem path. If the demo
  is deployed to a non-persistent host, swap to S3-compatible via a
  `StorageProvider` interface mirroring the `SettlementProvider`
  pattern. Defer until a deploy target requires it.
- **MusicBrainz rate limits** — `musicbrainz.js` caches every lookup for
  24h and sets a 1 req/s client-side throttle. Free API permits this.
- **Taste-graph consensus on ties** — currently alphabetical tie-break.
  Acceptable for the MVP; revisit if judges push back.

---

## Definition of done (for the whole plan)

- [ ] Every doc in `docs/` describes the Lepton Submission Marketplace
      and only that.
- [ ] `node proxy-server.js` is the one and only run command.
- [ ] `git grep -l "audio.lab\|elevenlabs\|turbopuffer\|termusic\|versions-tui"`
      returns zero matches.
- [ ] `bash scripts/doctor.sh` and `bash scripts/test_api.sh` and
      `npm test` are all green.
- [ ] The 60-second E2E demo path works on a fresh clone with mock Arc.
- [ ] The 8 Core Principles are referenced in the commit footer of every
      merged change.

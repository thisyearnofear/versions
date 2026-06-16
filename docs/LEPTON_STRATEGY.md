# ⚛️ LEPTON STRATEGY: VERSIONS Marketplace & Sidecar

## Status (June 2026)

- **Phase 1 — Submission Marketplace (Hackathon MVP):** ✅ Implemented. The 5-day
  build is complete; see `LEPTON_IMPLEMENTATION_PLAN.md` for the execution
  log. The repo ships with 54/54 tests green, an E2E smoke test, a doctor
  check, and a 3-tab web client.
- **Phase 2 — Subsonic Scrobble Sidecar (Stretch):** ⏳ Not built. The schema
  and the protocol-level shape are designed but no sidecar process exists.
  See *Phase 2* below for the design.

---

## 🎯 Vision: The Economic Home for the "Other" Music
VERSIONS is a two-sided marketplace and discovery layer for **alternate takes, live recordings, and demos** — the high-value music that currently has no economic home.

### The Core Insight
Artists play songs differently every night. Fans value specific versions ("the bluesy 2019 Gravity solo"). VERSIONS monetizes this through two interlocking systems:
1.  **Human-Powered Taste Graph**: Curation through structured, subjective metadata.
2.  **Nanopayment Settlement Layer**: Every interaction is a micro-transaction on **Arc L1 (USDC)**.

---

## 🚀 PHASE 1 (HACKATHON MVP): SUBMISSION MARKETPLACE — shipped
To bootstrap the catalog, we are starting with an active **SubmitHub-style marketplace** rather than passive streaming.

### The Mechanic
- **Artists**: Upload a version (MP3/FLAC) + metadata. Pay a **Submission Fee (USDC)** to enter the curation queue.
- **Curators**: Claim tracks and complete a **Structured Rating Form**.
- **Payout**: On submission, the fee pool is split: **70% to Curators, 20% to Platform, 10% to MusicBrainz Attribution**.
- **Discovery**: A version is "published" to the catalog after receiving **N=3** ratings.

### Structured Rating Dimensions
Curators don't just give stars; they map the "taste graph":
- **Solo Intensity** (1–10)
- **Vocal Quality** (1–10)
- **Energy vs. Studio** (Lower / Same / Higher)
- **Tempo Feel** (Dragging / Locked / Rushing)
- **Mood Tags** (Bluesy, Raw, Euphoric, etc.)

### Implementation

| Layer        | Lives in                                                          |
|--------------|-------------------------------------------------------------------|
| API + settlement | `proxy-server.js` (Node, single process)                      |
| Domain logic | `proxy/services/{submissions,curation,settlement,feed}.js`       |
| Settlement provider | `proxy/adapters/arc.js` (mock-first)                    |
| Schema       | `data/migrations/*.sql` (idempotent, applied at boot)            |
| Client       | `web/` (3-tab SPA, ES modules)                                   |
| Tests        | `proxy/__tests__/*.test.js` (54 node:test cases)                  |
| Docs         | `docs/LEPTON_API.md` (wire) + `docs/ENVIRONMENT_VARIABLES.md` (env)|

---

## 🛰️ PHASE 2 (STRETCH GOAL): SUBSONIC SCROBBLE SIDECAR
*Not built. The design below is for context.*

Once the catalog is bootstrapped, we enable passive per-second payments via a protocol-level shim.

### Architecture
- **Target**: Navidrome (primary), Koel, Funkwhale.
- **Function**: A lightweight process that runs alongside the media server, intercepts scrobbles, and triggers Arc L1 settlements for discovered versions.

### Why deferred
The sidecar requires a stable catalog of published versions to be economically interesting. Phase 1 produces that catalog. The schema and the settlement contract are the same — only the trigger changes from "rating submitted" to "scrobble received". The work in Phase 1 (settlement, taste-graph, feed) is the load-bearing layer for Phase 2.

---

## 🛠️ Implementation Mandates (all met in Phase 1)

### 1. "Marketplace First" ✅
The submission/rating flow is the first thing the user sees and the first thing the docs describe. The hackathon "win" is showing active USDC flow between artists and curators — and the smoke test demonstrates exactly that.

### 2. Structured Metadata ✅
The database supports the exact "Taste Graph" dimensions. Metadata is not an afterthought; it is the product. `validateRating` enforces every constraint server-side; the feed filters on it.

### 3. Arc-Native Settlement ✅
All fees and rewards are handled as discrete Arc L1 transactions. The settlement service is the only writer of `settlement_legs`; arc.sendTransfer is the single point of network egress. The mock-first policy lets the demo run without a testnet; the swap to real Arc is one config flag.

---

*Phase 1 of this strategy is the live product. Phase 2 is the design for what comes after.*

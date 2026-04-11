# ElevenHacks Implementation Plan

This plan aligns VERSIONS with the turbopuffer + ElevenLabs hackathon while preserving the existing product and architecture.

## Core Delivery Goal

Build a provider-agnostic audio pipeline:

`ingest -> index -> retrieve -> generate -> rank`

where:
- turbopuffer provides semantic indexing and retrieval
- ElevenLabs provides music and sound-effects generation
- Audius is one optional content adapter, not the product center

## Cliamp-Inspired Design Rules

- Enhancement first: extend the existing proxy and web app; avoid parallel apps.
- Source-agnostic core: providers are adapters behind stable interfaces.
- Unified command surface: one orchestration flow exposed consistently in API and UI.
- Operational UX: `setup`/`doctor`-style checks for env and connectivity.
- Session and cache awareness: fast repeated prompts with deterministic behavior.
- Predictable file layout: runtime, adapters, services, and routes separated by domain.

## 5-Day Execution Plan

### Day 1 — Consolidation and Bloat Cleanup

- Unify frontend API base/proxy helpers into a single shared module.
- Remove duplicate `proxyFetch` and base URL definitions from pages/scripts.
- Extract backend env + HTTP helpers from monolithic `proxy-server.js`.
- Fix stale references and dead demo links in docs.

Exit criteria:
- Single source of truth for API base URL and JSON request helper.
- No duplicated frontend proxy helper logic.

### Day 2 — Provider-Agnostic Backend Core

- Add `runtime` modules for config, HTTP, and error envelopes.
- Add adapter contracts for `ContentSource`, `VectorIndex`, `AudioGenerator`.
- Implement concrete adapters:
  - `audius` content source
  - `turbopuffer` vector adapter
  - `elevenlabs` generation adapter
- Keep handlers thin; domain logic moves to service layer.

Exit criteria:
- Existing Audius endpoints still function.
- New adapter modules are independently testable.

### Day 3 — Semantic + Generation Pipeline

- Add orchestration service for `search -> generate` composition.
- Add minimal endpoints:
  - `POST /api/v1/semantic/search`
  - `POST /api/v1/audio/generate`
  - `POST /api/v1/audio/compose`
- Add response ranking strategy (semantic score + prompt fit).

Exit criteria:
- Prompt-based composition flow works end-to-end with configured keys.

### Day 4 — UI Enhancement (Inside Existing App)

- Add one integrated panel for prompt-driven semantic audio generation.
- Reuse existing styling and components; no new framework.
- Add session-level caching for repeated queries and generated assets.
- Add explicit provider status indicators and actionable error messages.

Exit criteria:
- User can prompt, retrieve candidates, generate audio, and preview in one flow.

### Day 5 — Reliability, Story, and Submission

- Add focused tests for orchestration and adapter error handling.
- Add `doctor` endpoint/check script for environment readiness.
- Final bloat pass: remove superseded helpers/routes/files.
- Create demo script and recording checklist for viral-style submission video.

Exit criteria:
- Repeatable local demo in under 2 minutes setup.
- Clear submission narrative tied to turbopuffer + ElevenLabs.

## Architecture Guardrails

- DRY: one config module, one HTTP client wrapper, one schema location.
- CLEAN: transport (routes) never directly contains provider logic.
- MODULAR: adapters are replaceable without orchestration changes.
- PERFORMANT: cache retrieval and dedupe identical generation prompts.
- ORGANIZED: domain folders map to runtime/adapters/services/routes.

## Production Baseline (P0)

Implemented baseline hardening in the proxy layer:

- Request IDs attached to every API response (`x-request-id`).
- Consistent JSON error envelope with error code and request id.
- Input validation for prompt/query text, mode enum, and bounded numeric params.
- In-memory rate limiting on generation endpoints.
- Upstream request timeouts with configurable duration.
- TTL caching for semantic and generation requests.
- CORS allowlist support and JSON body size limits.
- Split health endpoints for liveness/readiness.
- `scripts/doctor.sh` to verify env + readiness before deploy.

Recommended environment variables:

- `ALLOWED_ORIGINS` (comma-separated; empty allows all origins)
- `JSON_BODY_LIMIT` (default `256kb`)
- `UPSTREAM_TIMEOUT_MS` (default `12000`)
- `RATE_LIMIT_WINDOW_MS` (default `60000`)
- `RATE_LIMIT_AUDIO_MAX` (default `30`)
- `SEMANTIC_CACHE_TTL_MS` (default `30000`)
- `AUDIO_CACHE_TTL_MS` (default `45000`)

# VERSIONS — Environment Variables

This is the single source of truth for every environment variable the
proxy reads. Defaults live in `proxy/runtime/config.js` and the
service constructors. Anything not listed here is not read.

## Required (Day 3+)

| Variable            | Purpose                                                                                  | Example                                |
|---------------------|------------------------------------------------------------------------------------------|----------------------------------------|
| `ARC_RPC_URL`       | JSON-RPC endpoint for Arc L1. Omit to run in mock-first mode.                            | `https://rpc.arc.testnet.arcscan.xyz`  |
| `ARC_USDC_CONTRACT` | Address of the USDC contract on Arc. Returned in `/api/v1/arc/info`.                     | `0xUSDC...`                            |
| `PLATFORM_WALLET`   | Recipient of the 20% platform leg and the 10% MusicBrainz fallback leg.                 | `0xPlat...`                            |

> **Mock-first policy** — When `ARC_RPC_URL` is missing or unreachable, the
> proxy falls back to a deterministic mock (`scripts/smoke-day4.js` works
> out of the box with no keys). The `mock: true` flag on every settlement
> response tells the UI to label balances as "simulated".

## Optional (Day 3+)

| Variable            | Purpose                                                                                  | Default |
|---------------------|------------------------------------------------------------------------------------------|---------|
| `AUDIUS_API_KEY`    | Enables the MusicBrainz→Audius wallet hint (Day 5 stub; the actual MBID→wallet lookup lands via the web client's connected wallet). | unset   |
| `MOCK_ARC=1`        | Forces mock mode even if `ARC_RPC_URL` is reachable. Useful for demos.                   | unset   |

## Server / Network

| Variable               | Purpose                                                                  | Default   |
|------------------------|--------------------------------------------------------------------------|-----------|
| `PORT`                 | Port for the proxy.                                                       | `8080`    |
| `HOST`                 | Bind address.                                                             | `0.0.0.0` |
| `ALLOWED_ORIGINS`      | Comma-separated CORS allowlist. Empty = allow all (dev only).            | empty     |
| `JSON_BODY_LIMIT`      | Default request body cap. Submissions route gets a separate 70 MB cap.    | `256kb`   |
| `UPSTREAM_TIMEOUT_MS`  | Timeout for outbound calls (Audius, MusicBrainz, Arc).                   | `12000`   |

## Rate Limiting

| Variable                  | Purpose                                  | Default   |
|---------------------------|------------------------------------------|-----------|
| `RATE_LIMIT_WINDOW_MS`    | Window for the audio-API rate limiter.     | `60000`   |
| `RATE_LIMIT_AUDIO_MAX`    | Max audio requests per window per IP.     | `30`      |

## Cache TTLs (advisory; current schema does not consume these)

| Variable                | Purpose                                                                | Default   |
|-------------------------|------------------------------------------------------------------------|-----------|
| `SEMANTIC_CACHE_TTL_MS` | TTL for the semantic-search cache (Day 4 leftover from the Audio Lab). | `30000`   |
| `AUDIO_CACHE_TTL_MS`    | TTL for the audio-generation cache (Day 4 leftover).                   | `45000`   |

## Database

| Variable   | Purpose                                                                  | Default                  |
|------------|--------------------------------------------------------------------------|--------------------------|
| `DB_PATH`  | Path to the SQLite file. Tests override this for isolation. Prod default. | `data/versions.db`       |

## Production deployment

Set variables directly in your platform (Hetzner / Railway / Fly.io /
Heroku). Never commit `.env` — it is gitignored.

## Local development

```bash
cp .env.example .env
# Edit .env, then run
node proxy-server.js
```

`.env.example` carries the key names with no values. The proxy boots
fine with no `.env` at all (everything required is mockable).

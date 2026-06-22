# VERSIONS — Environment Variables

This is the single source of truth for every environment variable the
proxy reads. Defaults live in `proxy/runtime/config.js` and the
service constructors. Anything not listed here is not read.

## Required (Day 3+)

| Variable            | Purpose                                                                                  | Example (verified live, June 2026) |
|---------------------|------------------------------------------------------------------------------------------|------------------------------------|
| `ARC_RPC_URL`       | JSON-RPC endpoint for Arc L1. Omit to run in mock-first mode.                            | `https://rpc.testnet.arc.network`  |
| `ARC_USDC_CONTRACT` | ERC-20 USDC interface on Arc testnet (6 decimals). Same balance as native USDC (18-decimal gas). | `0x3600000000000000000000000000000000000000` |
| `PLATFORM_WALLET`   | Hot wallet that holds testnet USDC for paying out settlement legs. Also the recipient of the 20% platform leg when the wallet is the platform. | `0xPlat...`                        |

**Arc Testnet constants** (from `https://docs.arc.io`):

- Chain ID: `5042002` (`0x4cef52`)
- Block explorer: `https://testnet.arcscan.app`
- Faucet: `https://faucet.circle.com` (select Arc Testnet)
- Native gas token: USDC (18 decimals for gas accounting)
- ERC-20 USDC: `0x3600000000000000000000000000000000000000` (6 decimals)
- Finality: sub-500ms, deterministic
- Min `maxFeePerGas`: 20 Gwei

> **Mock-first policy** — When `ARC_RPC_URL` is missing or unreachable, the
> proxy falls back to a deterministic mock (`scripts/smoke-day4.js` works
> out of the box with no keys). The `mock: true` flag on every settlement
> response tells the UI to label balances as "simulated".

## Going live: Day-1 bootstrap

The hackathon runs on Arc testnet. To flip from mock to live:

1. Install the Canteen ARC CLI (gives you a hosted testnet + RPC):
   ```bash
   uv tool install git+https://github.com/the-canteen-dev/ARC-cli
   ```
2. Set `ARC_RPC_URL=https://rpc.testnet.arc.network` and
   `ARC_USDC_CONTRACT=0x3600000000000000000000000000000000000000`
   (the ERC-20 USDC interface address; verified live).
3. Generate a hot wallet for the platform (or reuse one):
   ```bash
   node -e 'const nacl=require("tweetnacl");const kp=nacl.sign.keyPair();console.log("pub:",Buffer.from(kp.publicKey).toString("base58"));console.log("sec:",Buffer.from(kp.secretKey).toString("base58"))'
   ```
   Convert the base58 public key to the Arc address format
   (EVM-style `0x` + 20 bytes hex) and set `PLATFORM_WALLET`.
4. Get testnet USDC from `https://faucet.circle.com` (select Arc Testnet).
   Verify with `/api/v1/arc/info` — `platformUsdcBalance` should be > 0.
5. Verify the full live wiring:
   ```bash
   bash scripts/test-arc-live.sh
   ```
   Exit code 0 means: proxy boots in real mode, chainId is non-null,
   balance read works, and a settlement round-trip would succeed.

`/api/v1/arc/info` returns the live `chainId`, `usdcDecimals`,
`platformUsdcBalance` (raw micro-units as a string), and the `mock: false`
flag once the proxy is in real mode.

**Send USDC from your hot wallet:** the proxy never holds a key.
The artist (or the agent operator on Day 2) signs the broadcast. The
proxy encodes the calldata via `arc.buildErc20TransferCalldata({ to,
amountUsdc })` and the client signs and broadcasts. The Arc adapter's
`sendRawTransaction({ signedTx })` is the read-side: it accepts a
pre-signed transaction and returns the tx hash.

## Optional (Day 3+)

| Variable            | Purpose                                                                                  | Default |
|---------------------|------------------------------------------------------------------------------------------|---------|
| `MOCK_ARC=1`        | Forces mock mode even if `ARC_RPC_URL` is reachable. Useful for demos.                   | unset   |

## LLM Agent Reviews (Phase 2)

| Variable            | Purpose                                                                                  | Default         |
|---------------------|------------------------------------------------------------------------------------------|-----------------|
| `LLM_API_URL`       | OpenAI-compatible chat completions endpoint URL. Omit for mock reviews.                  | (empty = mock)  |
| `LLM_API_KEY`       | Bearer token for the LLM endpoint. Omit for mock reviews.                                | (empty = mock)  |
| `LLM_MODEL`         | Model name to request.                                                                    | `gpt-4o-mini`   |
| `AGENT_WALLET_1`    | Production agent wallet. Auto-generated if empty.                                         | auto-generated  |
| `AGENT_WALLET_2`    | Performance agent wallet. Auto-generated if empty.                                       | auto-generated  |
| `AGENT_WALLET_3`    | Market agent wallet. Auto-generated if empty.                                             | auto-generated  |

**Mock-first policy** — When `LLM_API_KEY` is missing, the LLM adapter
returns deterministic reviews with genre-specific venue/channel/influencer
data. The demo runs without any external LLM provider. The `mock: true`
flag on every review response tells the UI to label reviews as "AI
generated (mock)".

## A&R Agent (Phase 3)

| Variable            | Purpose                                                                                  | Default         |
|---------------------|------------------------------------------------------------------------------------------|-----------------|
| `AR_WALLET`         | A&R agent wallet. Receives listener payments and pays artists per play. Auto-generated if empty. | auto-generated  |

The A&R agent charges listeners $0.001 per play and pays artists $0.0005.
The $0.0005 margin goes to the A&R wallet. Both legs settle on Arc via
the existing adapter (mock-first when `ARC_RPC_URL` is empty).

## Server / Network

| Variable               | Purpose                                                                  | Default   |
|------------------------|--------------------------------------------------------------------------|-----------|
| `PORT`                 | Port for the proxy.                                                       | `8080`    |
| `HOST`                 | Bind address.                                                             | `0.0.0.0` |
| `ALLOWED_ORIGINS`      | Comma-separated CORS allowlist. Empty = allow all (dev only).            | empty     |
| `JSON_BODY_LIMIT`      | Default request body cap. Submissions route gets a separate 70 MB cap.    | `256kb`   |
| `UPSTREAM_TIMEOUT_MS`  | Timeout for outbound calls (Arc).                                          | `12000`   |

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

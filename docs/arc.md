# Arc & agentic rails

Every money movement is USDC on Arc (testnet now; mainnet ~2026-09-16).
Omit `ARC_RPC_URL` → deterministic mock hashes. Health:
`GET /api/health/ready`.

## Settlement

Submission fee splits into curator / platform / MusicBrainz / agent legs
via `src/adapters/arc.ts`. `PLATFORM_WALLET_PRIVATE_KEY` signs live
transfers. Sweeper retries stuck `pending` legs.

Go mainnet: swap `ARC_RPC_URL` / `ARC_USDC_CONTRACT` and the
`NEXT_PUBLIC_ARC_*` build args, rebuild, fund the treasury, `npm run check:arc`.

## x402

- **Tips** — `POST /api/x402/tip` (402 challenge → EIP-712 → batched USDC). Floor: 1 lepton ($0.000001).
- **Scored match** — signed-in `POST /api/x402/score` ($0.05 USDC to the Market agent). Guests keep free search.

## ERC-8183

A sync license is an Agentic Commerce job: open → fund → submit → complete.
Deliverable hash = brief + take + usage. Job IDs and tx hashes on the
dashboard. Live open/settle falls back to mock if RPC/funds fail (response
flagged `mock`).

## ERC-8004

Production / Performance / Market / A&R expose stable agent IDs at
`GET /api/v1/agents/identities`. Live `registerAgent` is not the default
path yet — health reports `erc8004.mock`.

## App Kit

Supervisor dashboard: **Send** USDC on Arc, or **Unified Balance**
(Base Sepolia → Arc) to fund the license treasury.

## Honest flags

UI and APIs badge `mock` when a leg did not hit the chain. Do not claim
mainnet or live 8004 registration unless health says so.

# Arc & agentic rails

Every money movement is USDC on Arc (testnet now; mainnet ~2026-09-16).
Omit `ARC_RPC_URL` → deterministic mock hashes. Health:
`GET /api/health/ready` reports `arc.mock` plus `channelProbe.mock`.

## Settlement — two rails, same Arc

### Submission-fee legs (legacy, kept)

Submission fee splits into curator / platform / MusicBrainz / agent legs
via `src/adapters/arc.ts` → `settlement_legs` (`uq_legs_submission_wallet_role`).
`PLATFORM_WALLET_PRIVATE_KEY` signs live transfers. Sweeper retries stuck
`pending` legs.

### Slot legs — marketplace (the new wedge)

A paid placement is a **flat 60/30/10 supplier / channel / platform** split
in `slot_legs` (separate table so `settlement_legs` invariants stay intact).
Created by `insertSlotLegsAtomic` (`slot_legs: supplier/channel/platform`
leg-count assertion), driven by `settleSlotLegsAsync`.

- `POST /api/v1/slots` → `pending_payment` (budget clamped to campaign headroom).
- `POST /api/v1/slots/:id/pay` → `active` (flat settles its 3 legs here; CPM escrows budget).
- `POST /api/v1/usage` → `slots.accrue` moves CPM spend with a guarded atomic `UPDATE … WHERE spent+delta <= cap`; cannot spend via the request body.
- `POST /api/v1/slots/:id/complete` → CPM settles accrued spend and refunds unspent escrow.

Campaign cap: `listings.budget_spent_usdc` is committed spend (moved once when a slot is paid, released on CPM completion). Delivery is bounded by each slot's own cap, which is itself clamped to the campaign's remaining headroom at creation — so delivery can never exceed commitment. Caps are enforced in the `WHERE` clause of the same statement that increments, so concurrent delivers cannot both read "under budget" and both write.

Both rails emit the durable receipt stream (`settlement-event`) via `emitDurable`
→ `outbox_events` → `drainOutbox` (cron + SSE reconnect).

Go mainnet: swap `ARC_RPC_URL` / `ARC_USDC_CONTRACT` and the
`NEXT_PUBLIC_ARC_*` build args, rebuild, fund the treasury, `npm run check:arc`.

## x402

- **Tips** — `POST /api/x402/tip` (402 challenge → EIP-712 → batched USDC). Floor: 1 lepton ($0.000001).
- **Scored match** — signed-in `POST /api/x402/score` ($0.05 USDC to the Market agent). Guests keep free search.

## ERC-8183 (brief→license, kept)

A sync license is an Agentic Commerce job: open → fund → submit → complete.
Deliverable hash = brief + take + usage. Job IDs and tx hashes on the
dashboard. Live open/settle falls back to mock if RPC/funds fail (response
flagged `mock`). This rail now coexists with the slot rail; unify later if
the product converges on one checkout.

## ERC-8004

Production / Performance / Market / A&R expose stable agent IDs at
`GET /api/v1/agents/identities`. Live `registerAgent` is not the default
path yet — health reports `erc8004.mock`.

## App Kit

Workspace: **Send** USDC on Arc, or **Unified Balance** (Base Sepolia → Arc)
to fund treasuries (license or slot budget).

## Honest flags

UI and APIs badge `mock` when a leg or stat did not hit the platform. Do not claim
mainnet, live 8004 registration, or verified reach unless health says
`*.mock = false` / `verification_status = 'verified'` + `stats_source = 'platform_api'`.

## Channel verification (new)

Supply-side money is gated by **verified distribution**:

- `POST /api/v1/channels` probes YouTube (`GET channels.list` + `playlistItems`) with 5 s timeout. No `YOUTUBE_API_KEY` → deterministic mock channel with `verification_status: 'pending'` and `stats_source: 'mock'` — can browse, cannot buy.
- `POST /api/v1/channels/:id/verify` re-probes a pending channel (only after the key is configured).
- `can_buy_slots` is `verified && active` — the single predicate every buy path checks (UI + service).
- `ChannelRegisterSchema` is `.strict()` and has **no stats field** — a 400 for `subscriberCount` is structural proof that self-reported reach is never accepted.

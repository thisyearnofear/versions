# Demo runbook — Circle / Arc

Live: https://versions.persidian.com · Arc testnet USDC · all txs verifiable
on ArcScan.

**One line:** VERSIONS is the matching + settlement layer for distribution
channels — one listing primitive for music *and* product placements, free
with attribution or paid as a sponsor slot, settled 60/30/10 on Arc.

## What's live on prod right now (seeded 2026-09-17)

- **32 listings** across both catalogs (`lo-fi night drive / study / focus`
  slice) — 18 music + 14 placements, free + paid tiers.
- **5 channels, all verified via `platform_api`** — real YouTube stats, not
  self-reported: Lofi Girl (15.8M subs / 2.68B views), Chillhop Music (3.3M),
  NewRetroWave (1.4M), College Music (1.18M), MAJ (1.13M).
- **1 paid slot settled for real on Arc** — $1 flat fee on "Analog Drift",
  split into three confirmed legs (see proof below).
- **2 usage events** — 1 sponsored + 1 organic, `by_reporter` split visible.

## Click-through (5 min)

1. **Browse** — https://versions.persidian.com/discover
   - Search `lo-fi night drive` → `mode: semantic` ranking, `fit_score` +
     `why_fits` citations inline. Same primitive serves tracks and products.
   - Kind/tier filters; free rows show generated `attribution_text`, paid
     rows show `#ad` disclosure + price.
2. **Channels** — https://versions.persidian.com/channels
   - The fraud gate: `verified && stats_source='platform_api'` is the only
     way to `can_buy_slots`. Self-reported reach can never buy.
3. **Buy a slot live** (optional, ~30s) — sign in as the platform wallet
   (`DEMO_SIGNIN_PK=$PLATFORM_WALLET_PRIVATE_KEY npm run demo:signin`, or
   connect wallet), pick a paid listing → channel picker → confirm. Flat
   fee settles all three legs immediately.
4. **The money** — show the settled legs on ArcScan:

   | Leg | Amount | Tx (ArcScan) |
   |-----|--------|--------------|
   | Slot payment (buyer → platform) | $1.00 | `0xa538ca117a9b7e74365cc4d3b517ac2524a4d6802e59db220a3b36d492b4d8c2` |
   | Supplier 60% | $0.60 | `0xe809fd76b3958d9f1da721bb1102fb997030b71bdcf7755c6fff67931a114144` |
   | Channel 30% | $0.30 | `0x3c57ba6619be84da1a2405b5bd51ec5d3a7bb3c988a6fe448108d16ae50f440e` |
   | Platform 10% | $0.10 | `0x176c241afbf50fba897b2b181c36f9c7d61276a9ed626430f00e360bcedf845f` |

   Explorer base: `https://testnet.arcscan.app/tx/<hash>` — all `status: 0x1`,
   blocks ~62624573–62624593 (2026-09-17 ~20:07 UTC).

   Talk track: *"A $1 placement just paid three parties atomically — sixty
   cents to the artist, thirty to the channel, ten to the platform. That's
   uneconomical on card rails; it's one block on Arc."*

5. **Attribution / tracking** — the slot's tracking link
   `https://versions.persidian.com/t/vs_cnONXVw9nvWk94gW` 302s to the listing.
   `GET /api/v1/usage` shows the `by_reporter` split (channel vs
   platform_api vs manual — channel-reported delivery is never laundered
   into "verified").

## If they ask "is this real?"

- `GET /api/health/ready` → `arc.mock: false`, `llm` live (Venice +
  fallbacks), `embedding` live (OpenRouter), `channelProbe.mock: false`.
- The seeded supplier/channel wallets are demo wallets — flagged honestly:
  `slots.payment_mock` would be `true` for unsigned buyers; the seeded slot
  used the platform wallet as buyer so even the inbound charge is a real tx.
- YouTube stats come from the live Data API at verify time
  (`stats_verified_at` timestamp per channel).

## Recovery / re-seed

```bash
# full wipe-safe re-run (idempotent — skips existing listings/channels):
set -a && . /home/linuxuser/versions/.env && set +a   # on the server
npm run seed:marketplace
# or from a laptop checkout with the server .env exported:
npx tsx --env-file=.env scripts/seed-marketplace.ts
```

Platform treasury: `0x9c4ce0eBa26Bf5D04FAdD67692429E20ace2fB63` —
~23.9 USDC after the faucet drip; each $1 demo slot costs ~$0.60 net
(supplier leg) + gas. Refill: faucet.circle.com → Arc Testnet, 20 USDC / 2h.

## Known caveats to not get caught on

- `usage_events` are `reported_by: channel` — delivery is channel-reported
  until platform-API ingestion ships. Say that if asked; the `by_reporter`
  split exists precisely so we never blur it.
- `/api/v1/slots` is auth-gated (401 anonymous) — a channel's campaigns are
  not public. Use the signed-in UI or a `demo:signin` cookie to show them.
- Seeded usage video URLs are placeholders (`demo-beachhead-*`); the
  tracking code + redirect are real.

# Delivery ingestion — turning "channel-reported" into platform-verified

*Status: spec, not built. Related: [STRATEGY.md](../STRATEGY.md) §2 "Honest
capability gaps" · usage trust boundary in `src/services/usage.ts` (header) ·
[primitive-api.md](./primitive-api.md) · [guided-demo-and-billing.md](./guided-demo-and-billing.md).*

## Why this is the #1 roadmap item

The moat claim is the match → use → **proof** → settlement graph. Today the
proof node is a promise: `usage_events.reported_by` defaults to `channel`,
and the only `platform_api` writes are channel *reach* probes (subscriber
counts at verification time). Per `src/services/usage.ts`: *"Platform APIs
cannot currently confirm that a specific video used a specific track."* True
— but YouTube's public data confirms more than we currently ingest, and
CPM billing today accrues against self-reported impressions. Verified
delivery converts the brand moat ("never overclaims") into a measurable
one, and makes sponsored spend billable on platform numbers.

## What can and cannot be verified — stated honestly

For a usage row claiming "listing L ran in video V on channel C":

| Claim | Verifiable? | How |
|---|---|---|
| V exists and belongs to C | **Yes, no OAuth** | `youtube.videos.list` (`snippet.channelId`) with the existing `YOUTUBE_API_KEY` |
| V is public and recent | **Yes, no OAuth** | `snippet.liveBroadcastContent`, `status.privacyStatus`, `publishedAt` |
| The credit was rendered | **Yes, no OAuth** | description contains the attribution link (`/listings/:id`) or the slot's `/t/:code`; paid rows additionally carry the disclosure label (`#ad`). Compare via `attributionHash()` in `src/lib/attribution.ts` (tolerant substring match first — channels reflow whitespace) |
| Impressions (views) on V | **Yes, no OAuth** | `statistics.viewCount` is public |
| Views by traffic source, watch-time, monetizable plays | P1, OAuth | YouTube Analytics API (`youtube-analytics.readonly` scope) |
| That V's audio actually contains track L | **No** | requires fingerprinting (Content ID territory). The placement *claim* stays channel-originated; the platform verifies context + metrics, not audio |

**Language rule:** a `platform_api` row means *"placement context and
delivery confirmed against the platform"*, never *"content proven"*. UI copy
must phrase verification that way.

## P0 — Public-data verifier (no OAuth, no token vault)

New adapter `src/adapters/youtube-verify.ts` (mock-first like every adapter;
`/api/health/ready` gains `deliveryVerify: mock|live`).

1. **Input:** usage rows with `video_url` or `external_content_id` and
   `reported_by = 'channel'` — extract the 11-char video id.
2. **Probe:** `videos.list?part=snippet,status,statistics,contentDetails`
   batched ≤50 ids/call. Assert `snippet.channelId === channel.platform_channel_id`.
3. **Attribution check:** description contains `attributionUrl(listing_id)`
   **or** the slot's `tracking_url`; if the row's slot is paid, require the
   disclosure label too. Record which tokens matched.
4. **Verdict:** all assertions pass → write a *new* usage row
   `reported_by = 'platform_api'`, `kind` mirrored, `impressions =
   statistics.viewCount`, `spend_usdc` written only via the accrual path
   below. Fail → record the failure reason, leave the channel row as-is.
   **Never mutate a channel row into a platform row** — the two rows are two
   reports, and the `by_reporter` split stays legible (same laundering rule
   as reach stats).
5. **Idempotency / cadence:** dedupe on `(listing_id, channel_id,
   external_content_id, verified_window)`; re-verify daily for `active`
   slots so impression counts refresh; stop after slot `settled`/`completed`
   (final leg already fixed the money). Piggyback the existing cron at
   `src/app/api/cron/sweep` alongside `drainOutbox`/`pruneRetention` —
   single-instance constraint already documented in [deploy.md](./deploy.md).
6. **Quota:** `videos.list` costs 1 unit; ≤50 rows/lookup ≈ the beachhead's
   entire usage table for 1–2 units/day. Well inside the free 10k quota.

### Accrual change (money, gated)

`slots.accrue` is the single cap enforcement point. P0 adds a **verified
delta recompute**: when a `platform_api` row refreshes impressions for an
active CPM slot, accrue `max(0, verified − previously_accrued)` through the
same guarded `UPDATE … WHERE spent+delta <= cap`. Verified numbers may only
increase accrued impressions for a slot, never silently lower billed spend
mid-campaign (adjustments are a separate ledger event; keep it that way
until there's a real dispute to settle). Flat-fee slots: verification is
reporting-only, no accrual.

### Schema

`usage_events` gains (via one reviewed migration):
`verification_status text` (`unverified | verifying | passed | failed`),
`verified_at timestamptz`, `verification jsonb` (matched tokens, probe
snapshot, video state at check time — the receipt behind the badge). The
existing `reported_by` CHECK constraint is untouched.

### UI

- `by_reporter` split already surfaces on `/discover`
  (`MarketplaceBrowse.tsx`); add a `platform-verified delivery` chip on
  listing pages when a passed row exists.
- Landing demo: the LiveDemoButton tour's "Delivery log" step badges
  `platform_api×n` when non-zero — proof the graph is real, no code change
  needed beyond reading the field.
- `/t/:code` stays first-party click measurement; do **not** count redirect
  hits as impressions (unchanged comment in `src/app/t/[code]/route.ts`).

## P1 — Analytics API (OAuth)

Only after P0 ships and ≥1 channel disputes a self-report in the wild.

- Add `youtube-analytics.readonly` scope at channel connect (NextAuth
  credential flow already gates writes; store tokens encrypted server-side,
  refresh on sweep, detect revocation → drop to channel-reported and mark
  the channel `verification_revoked`).
- Reports: `channel=content` by video + `views, impressions,
  impressionClickThroughRate, estimatedMonetizedPlaybacks` — the fields a
  sponsor actually buys. `monetizedPlaybacks` is the anti-inflation number.
- Open question: whether CPM billing moves from `views` to
  `monetizedPlaybacks` — decide with the first real sponsor, not now.

## P2 — Beyond YouTube

The verifier is an interface: `verifyDelivery(claim) → { platform,
verdict, metrics, snapshot }`. Podcast RSS hosts expose public episode
pages (description grep + download counts where the host provides them);
TikTok/Shorts are public `oEmbed` + stats. Each new platform is a verifier
adapter, not a schema change — this is what "earn the marketplace before
the abstraction" (STRATEGY §6) buys us for free.

## Fraud surface (name it, don't hand-wave it)

- **View inflation (bots):** public `viewCount` is inflatable; that's why
  P1's monetized-playbacks matters. P0 mitigation: require the video to be
  ≥24h old before passing verification, and show views-per-hour sanity next
  to any aggregate on supplier dashboards.
- **Description stuffing:** a channel can paste every listing link into one
  video's description. Mitigation: verification only counts for a slot/
  listing when the *claim* references that video id — a passed check with no
  matching claim never accrues spend; plus one listing family per video per
  day cap on passing rows (env-tunable).
- **Claimed-then-deleted video:** re-verify on the daily sweep; a
  `privacyStatus → private` flips the row's `verification_status` to
  `failed` on next touch and flags the slot.

## Go/no-go metric

Beachhead exits P0 when: **≥80% of usage events with a video reference
carry a passed `platform_api` row**, and at least one supplier-facing report
shows "self-reported by channel → confirmed by platform" side by side. Until
then, keep saying *channel-reported* everywhere — the discipline is the
product.

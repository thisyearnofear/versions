# VERSIONS — Strategy & Positioning

**Thesis.** VERSIONS is the **matching, attribution, and settlement layer
for distribution channels**. We win from a **wedge — one unified primitive**
positioned as **ad infra for the AI distribution wave**:
*a marketplace where channels (YouTube automation, radio-style feeds,
etc.) browse a feed of music and product placements, pick what fits
their content's ethos, and use it — free with attribution or paid as
a sponsor slot — with matching, attribution tracking, and flat USDC
settlement on Arc taking a cut of every paid transaction.*

> **Positioning statement**
> VERSIONS turns any channel's ethos into shoppable supply — music and
> products as the same primitive (a slot in a feed, matched by ethos,
> free or paid) — and owns the cross-platform match → use → proof →
> settlement graph no incumbent is building, because their money is in
> creation and streaming, not in making AI distribution monetizable.

---

## 1. What we are — and are not

- **We are** a marketplace with two supply catalogs and one demand
  surface: **music + product placements** as the same primitive, matched
  against a verified channel's ethos, with the attribution and
  settlement rail underneath. Model: **NCS** (NoCopyrightSounds) —
  free-with-attribution for organic use, a separate paid/commercial
  gate for monetized or sponsored use, ~500B plays, single blanket
  agreement instead of bespoke contracts.
- **We are not** a per-track licensing negotiation shop. No bespoke
  consent policies, no territory-by-territory rights tracking, no
  AI-training consent flags, no lawyer-drafted-per-program agreements.
  One blanket ToS covers all free usage.
- **We are not** a generation platform. Creation tools stay external and
  tool-agnostic — we never compete with the model layer.
- **We are not** a consumer remix feed. Since May 2026, Spotify/UMG own
  "fans make licensed AI covers, consumed on-platform." That lane is
  occupied; we don't enter it.
- **We are not** a catalog competing on library size. The wedge is the
  matching + attribution + settlement rail, not the size of the shelf.

## 2. The wedge: one primitive, two catalogs, two tiers

The primitive is the **listing** — a slot in a feed that a channel can
pick up — and the **channel** that picks it:

- **Listings** (`listings`): `music` (audio, features, mood/genre tags)
  or `placement` (brand/product name, images, short pitch, target ethos
  tags). Both carry `tier: free | paid`, and when paid `pricing: flat |
  cpm` + optional `budget_cap_usdc`. Both are embedded into the same
  vector space as channel ethos, so Browse can surface either kind.
- **Channels** (`channels`): a real distribution surface (YouTube at
  minimum for v1). We pull subscriber/view numbers from the platform's
  own API — no self-reported stats. Channel profile = the ethos
  embedding input (recent titles/descriptions, stated niche/genre).
  Only a `verified` channel can buy a paid slot.
- **Free tier** — one blanket click-through at listing creation (supplier)
  and at channel registration (channel). Every free use must render a
  generated `attribution_text` + link (`/listings/:id`) unmodified.
  Every use — free or paid — is logged (`usage_events`: who, what,
  when, where). This is the data flywheel and the future sales proof
  ("our catalog gets used X times/month") for the paid side.
- **Paid tier — the ad infra** — self-serve buy flow: set budget, pick
  flat/CPM, checkout on existing Arc/x402 rails. Every paid placement
  mints a unique `tracking_code`/`tracking_url` (`/t/:code` → listing)
  so delivery is attributable from day one. Flat settlement split:
  **60/30/10 supplier / channel / platform** via `slot_legs`; no
  waterfall. Campaign/budget cap enforced by a guarded atomic
  `UPDATE … WHERE spent+delta <= cap` at both slot (`accrue`) and
  campaign (`listings.budget_spent_usdc`) levels. Paid listings carry a
  `disclosure` (`#ad` / `Paid promotion`) baked into the attribution
  the channel must render — FTC/platform sponsored-content rules apply
  to AI-run channels exactly as to human ones.

We sell the **outcome** — a matched, attributable, settled placement —
not a similarity API, not a sync-negotiation service, not a streaming
surface.

### Honest capability gaps

- **Matching is still structured + text embedding.** Audio features
  still help music↔channel fit, but channel-ethos matching is an
  embedding problem that compounds only once usage data accumulates.
- **Usage reporting is channel-reported by default.** The `reported_by`
  field (`channel | platform_api | manual`) must stay visible in every
  aggregate — we do not launder self-reported delivery into "verified."
  Platform-verified delivery is a future ingestion path, not a shipped
  one.
- **No per-track bespoke terms.** By design — but it means we cannot
  promise a negotiated price, territory carve-out, or training opt-out
  per listing.

### Product expression

The browse and supply surfaces must feel like **one marketplace**, not
"music here, products there." Browse filters by kind/tag/budget;
Supply uses one card with a kind toggle; Channels connects once and
unlocks the paid tier everywhere. The wallet and settlement rail remain
proof and execution infrastructure — never the front door.

Trust is part of the product. We show verification source (`platform_api`
vs `mock`), disclosure, and budget-remaining exactly where the money
decision happens, and every aggregate carries its reporter split.

## 3. Why incumbents are disincentivized

- **DSPs (incl. Spotify's new product):** consumer creation → on-platform
  consumption. Cross-platform **monetization of AI distribution** (which
  track or product fits this automated channel, who gets paid, how the
  sponsor disclosure travels) is outside the ad/sub model. → disincentivized.
- **Labels / production-music catalogs:** derivative distribution
  commoditizes the curation premium and the human sync model. →
  under-invest in zero-marginal matching + micro-settlement.
- **Creation-tool vendors (Suno, ElevenLabs, …):** incentive is generation
  volume; attribution enforcement and budget-capped settlement are costs.
  → won't build the conversion rail.
- **Ad networks:** won't build the supply-side marketplace (music as
  inventory, disclosure-aware attribution) because their inventory is
  impressions, not content slots.

The vacuum is the **unglamorous matching + attribution + budget rail**
for AI-run distribution — exactly what makes paid AI distribution
trustworthy to a brand.

## 4. The moat (Thiel's four, applied)

| Moat | Strength | Our edge |
|---|---|---|
| Proprietary tech | Weak → real but not primary | Embeddings + matching commoditize; keep it, don't bet on it. |
| Economies of scale | Strong | Marginal cost to match listing #N ≈ 0 → we dominate the long tail of supply×channels. |
| Network effects | **Strongest** | The **listing → match → use → spend → settlement** graph per channel: who used what, where, how much delivery cost, which ethos actually converted. Two-sided: more suppliers → more channels → more logged uses → better matching → more paid placements. No single platform sees both sides. |
| Brand | Secondary | As infrastructure: trust = verified reach, non-forgeable attribution, atomic budget caps, and never double-spending a campaign. |

**The bet to place:** becoming *the memory of what was matched, what
was used where, and what settled — per listing, per placement, per
impression.* The blanket agreement + attribution format + flat split are
the product standards a competitor would have to re-negotiate listing by
listing.

## 5. Build distribution into the product (Thiel)

- **Browse is beachhead + distribution + pricing leverage** — how we win
  a niche ethos, generate logged uses, and prove demand to suppliers.
- **Supply is the flywheel input.** Each listing is both inventory and a
  proof point; each logged use (video URL when available) is marketing.
- **Channels are distribution nodes.** Any channel that connects once is
  a recurring buyer; its ethos embedding improves every future match.
- **Settlement is a brand moment (Stripe-style).** Every `slot_leg`
  settled and every `usage_event` with spend is a verifiable receipt.
- **We are the best operator, not network-neutral.** Win our own
  marketplace liquidity first; let others consume the rail later.

## 6. Beachhead → expand

1. **Beachhead (weeks, not quarters — move fast):** tens of suppliers
   across both catalogs (music + placements) with free-with-attribution
   supply that actually fits a few target channel niches (lo-fi, study,
   morning-routine, thriller tension); a handful of real YouTube channels
   verified and browsing; a working paid placement that settles 60/30/10
   and logs usage where it ran. Go/no-go by evidence:
   - *Supply:* ≥50 listings across both catalogs, ≥1 tag that actually
     discriminates (not "music"), ≥1 paid listing with cap+disclosure.
   - *Demand:* ≥3 verified channels; ≥1 paid slot bought self-serve;
     ≥1 channel reports where it ran (video URL) without being chased.
   - *Ops:* every paid listing shows `remaining_budget`; every spend
     event resolves to a slot leg; no spend without a slot; no self-
     reported reach ever unlocks `can_buy_slots`.
2. **Picks-and-shovels:** originate repeatable supply (artists +
   brands) and repeatable demand (automation operators). Sell the
   **matched placement** as the outcome.
3. **Expand (optional compaction):** abstract the attribution +
   tracking + capped settlement rail beyond music — every agentic
   distribution business needs it. Different, bigger company; earn the
   marketplace before abstraction.

## 7. Honest risks / caveats

- **Trust without verification.** Until platform APIs confirm delivery,
  `usage_events` are channel-reported. Aggregates must always show the
  `by_reporter` split — over-claiming verification is existential.
- **Blanket agreement risk.** One ToS is the product — but it means a
  single legal challenge touches every listing. Keep the agreement
  versioned (`marketplace-1.0.0` stamped on every row) and auditable.
- **Two-sided cold start.** Invited supply + invited channels only at
  first; open supply without channel verification invites fraud.
- **Claim honesty.** "Settled" only for uses VERSIONS tracks and caps;
  "verified reach" only for `stats_source = 'platform_api'`. Never
  upgrade a `mock` or `channel`-reported row in copy.
- **Commodity matching trap.** Selling raw recall is commodity; sell the
  *placed and settled outcome* and the *channel ethos graph*.

---

*History: the 2026-08 predecessor framed the wedge as "consent, curation,
and settlement for artist-authorized versions" (STRATEGY.md @ 2026-08).
Weak demand for per-program bespoke licensing + the need for a
distribution-side monetization wedge drove the 2026-09 pivot to a
dual-vertical marketplace with NCS as the model. The settlement, Arc,
and embedding rails are unchanged; the thesis and supply primitive are.*

*This file is the source of truth for product strategy. Do not duplicate
the reasoning in README.md — link here. Implementation: [docs/README.md](./docs/README.md).*

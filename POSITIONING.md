# VERSIONS — Positioning One-Pager

*For external stakeholders. Thesis: [STRATEGY.md](./STRATEGY.md). Build: [README.md](./README.md) · [docs/](./docs/README.md).*

---

## The one-liner

**VERSIONS is ad infra for AI-run distribution.** A marketplace where
channels browse music and product placements, pick what fits their
ethos, and use it — free with attribution or paid as a sponsor slot —
with matching, attribution tracking, and settlement on Arc. Every
placement ends as a verifiable, budget-capped receipt.

## The wedge — said precisely

- **The wedge is the beachhead buyer:** the operator of an
  ethos-curated distribution channel (lo-fi / study / morning-routine
  YouTube automation first) who has an audience but no clean way to
  monetize it. We win ~50 of those channels before we widen.
- **The unified listing is the product insight, not the wedge:** music
  and products are the same primitive — a slot in a feed, matched by
  ethos, free or paid — so one rail serves two catalogs.
- **Free-with-attribution is the cold-start mechanism, not the wedge:**
  the NCS play. It seeds supply, makes every use a logged data point,
  and produces the sales proof ("this catalog gets used N times a
  month") that makes the paid side sellable. Paid ("ad infra") is the
  business.

## Three customers, three sentences

- **Supplier (artist or brand):** "List a track or a product once under
  a blanket agreement; it earns from AI distribution with zero
  negotiation — USDC receipts, 60% of every placement."
- **Channel operator (the buyer):** "Your feed becomes shoppable —
  supply that fits your ethos, cleared instantly, and you keep 30% of
  every slot you run. No sales call, no sync negotiation."
- **Sponsor (the eventual payer):** "Verifiable presence inside niche
  channels with platform-verified reach, a baked-in ad disclosure, and
  a budget cap that cannot be overspent."

Today the channel buys slots; economically the brand will fund them.
That expansion is deliberate — the 60/30/10 is the standing answer,
not an open question.

## The problem

AI-run distribution is scaling fast, but monetizing it is stuck in two
broken modes: free music with no credit, and sponsorships negotiated as
one-off deals. Suppliers have inventory that should be shoppable;
channels have niche audiences that should be monetizable; no rail turns
a good fit into a verifiable, budget-capped placement.

## How the loop runs

List → connect & verify the channel's reach against the platform API →
browse one ranked feed matched to the channel's ethos → use free (render
the attribution unmodified) or buy a slot (flat/CPM, budget cap, Arc
checkout) → every use logged, every paid impression capped atomically →
settlement as flat **60/30/10 supplier / channel / platform** legs on
Arc. We sell the **placed, trackable outcome** — not a similarity API,
not a bespoke license, not a streaming surface.

## The honesty is the product

- **Reach:** only platform-API numbers count; self-reported numbers
  never unlock the paid tier.
- **Delivery:** every usage event records *who reported it*
  (`channel | platform_api`), and every aggregate shows the split. We
  never launder a self-report into a "verified."
- **Settlement:** "settled" means a `slot_leg` on Arc with a tx hash;
  mock rails are badged mock.

Nobody else publishing receipts this disciplined is credible in a feed
full of AI slop. That is our brand moat.

## Why we win

- **Incumbents can't follow.** DSPs, labels, creation tools, and ad
  networks each own one side; none builds the cross-platform match →
  use → proof → settlement graph because it conflicts with their core
  model.
- **The graph compounds.** Every listing, match, logged use, and
  settled leg makes the next match cheaper and more accurate. No single
  platform sees both supply and demand.
- **Zero marginal cost to match listing N.** Scale favors us; bespoke
  negotiation and human curation don't.

## The ask

A track or product we can list under the blanket terms, or a YouTube
channel we can verify. That's the marketplace — everything else
(matching, attribution, tracking, settlement) is already running.

---

*Strategy: [STRATEGY.md](./STRATEGY.md) · Build: [README.md](./README.md) · [docs/](./docs/README.md)*

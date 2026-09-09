# VERSIONS — Strategy & Positioning

**Thesis.** VERSIONS is the **matching, attribution, and settlement layer for
AI-run distribution channels**. We win from a **wedge — one agentic primitive** —
positioned as **picks-and-shovels for the commercial end of automated
distribution**: *a channel's ethos → a feed of music and product placements →
free use with attribution or a paid sponsor slot → tracked attribution and
micro-settlement on Arc USDC*. Music placement and product placement are the
SAME primitive — a "slot" in a feed, matched by ethos, free or paid — with two
different supply catalogs. Our moat is the compounding **attribution graph +
verified distribution + settlement rail** + zero-marginal-cost matching scale.

> **Positioning statement**
> VERSIONS is where AI-run distribution channels (YouTube automation, radio-style
> feeds, and the rest) discover, use, and pay for the music and product
> placements that fit their content's ethos — free with attribution for organic
> use, or a flat-fee/CPM sponsor slot for monetized or sponsored use — with
> every use attributed and settled on Arc. We are the NCS of the AI-distribution
> era: one blanket agreement, no per-track negotiation, and a single conversion
> rail no incumbent is building, because their money is in streaming, labels, or
> human-sold ad campaigns — not in the automated cross-channel schlep.

---

## 1. What we are — and are not

- **We are** the automation of the placement *schlep* for **AI-run distribution
  channels**: matching a channel's ethos to a feed of music and product
  placements, tracking attribution for every use, and settling paid slots on
  Arc — at a scale and speed human ad-sales and sync teams can't reach at cost.
- **We are not** a generation platform. Creation tools (music models, video
  pipelines) stay external and tool-agnostic — we never compete with the model
  layer.
- **We are not** a per-track sync-licensing business. No bespoke consent
  policies, no lawyer-drafted-per-program agreements, no territory rights
  tracking, no royalty waterfalls. One blanket ToS covers all free usage; paid
  usage is a flat-fee/CPM slot, not a negotiated license.
- **We are not** a consumer remix feed. Since May 2026, Spotify/UMG own
  "fans make licensed AI covers, consumed on-platform." That lane is occupied;
  we don't enter it.
- **We are not** a catalog competing on library size. Size is an incumbents'
  game; we build the differentiated supply (music + product placements) and the
  conversion rail they won't.

## 2. The wedge: one primitive, two supply catalogs

The primitive is the *channel ethos → feed → free-or-paid slot → attribution +
settlement* pipeline:

- a channel registers and connects a real distribution surface (e.g. a YouTube
  channel URL); we pull real subscriber/view numbers via public API — never
  self-reported,
- the channel's content description/history is embedded into the same vector
  space as every listing,
- the channel browses a feed of music and product placements ranked by ethos
  fit, and uses a listing — free with attribution, or a paid sponsor slot,
- every use is instrumented (which channel used which listing, when, where) and
  paid slots settle on Arc USDC via a flat 3-way supplier/channel/platform
  split.

**One listing, two kinds.** A unified `listing` concept with a kind
discriminator:

- **`music`** — audio file, audio features, mood/genre tags, free-or-paid flag,
  flat fee if paid.
- **`placement`** — brand/product name, image(s), short pitch, target ethos
  tags, CPM or flat fee, campaign budget/cap.

Both embed into the same vector space as channel ethos. Music placement and
product placement are the SAME primitive — a slot matched by ethos, free or
paid — with two different supply catalogs, not two different products.

**Free tier (the wedge + data flywheel).** One blanket click-through agreement
at listing-creation and channel-registration; attribution string/link required
on free placements; every free usage instrumented. Free usage is the
distribution/adoption wedge and the labeled-data flywheel — and the future sales
proof ("this catalog was used X times this month") — not a loss leader.

**Paid tier ("ad infra").** Self-serve buy flow — a channel or brand creates or
accepts a paid slot, sets budget, flat-fee or CPM, checks out via Arc/x402.
Each paid placement carries a unique trackable attribution identifier.
Settlement is a simple flat split (supplier / channel / platform). A campaign
budget/spend cap stops serving once spent.

**Compliance.** Paid placements carry a disclosure marker (FTC/platform
sponsored-content requirements) built into the paid-listing data model from
day one.

We sell the **outcome** — matched, attributed, settled placements — not a raw
similarity API, not a creation tool, not a streaming surface.

### Honest capability gaps

- **Matching scores metadata + audio features, not listening.** Ethos matching
  embeds channel content description/history and listing tags/audio features;
  it does not listen to audio or watch video. Don't claim it does until
  audio-aware evaluation ships.
- **Verification is public-API reach, not deep engagement.** Subscriber/view
  numbers come from public APIs (real, not self-reported), but they measure
  reach, not engagement or monetization quality.
- **"Settled" only for uses VERSIONS tracks and controls.** Free uses are
  instrumented and attributed, but settlement claims apply only to paid slots
  that clear our rail.
- **Free usage is the proof, not a guarantee.** Attribution is required, but
  enforcement of attribution on free uses is a trust and data problem, not a
  legal guarantee — the instrumentation is the evidence.

### Product expression: the channel feed workspace

The channel surface must present a **decision and an executable next step**,
not a catalog list with a score. For every recommendation, make the matching
evidence (why this fits this channel's ethos), the free/paid terms, and the
attribution string legible in the workflow. The wallet and settlement rail
remain proof and execution infrastructure — never the front door.

Trust is part of the product. We show attribution and settlement status only
when the corresponding result-level evidence exists and is auditable. **Claim
discipline:** "settled" applies only to paid slots VERSIONS tracks and
controls; matching claims say "matched to ethos," not "listened and approved."

## 3. Why incumbents are disincentivized

The model is NCS (NoCopyrightSounds): free-with-attribution for organic use, a
separate paid/commercial gate for monetized or sponsored use, ~500B plays, one
blanket agreement instead of bespoke contracts. NCS proved the demand; nobody
has built the *automated marketplace* on top of it. What no incumbent is
building — and why:

- **Spotify / UMG:** consumer creation → on-platform consumption (fan covers,
  2026-05-21). Cross-platform **commercial conversion for AI-run channels** —
  ethos-matched placements, free-with-attribution instrumentation, per-use paid
  slots — is a schlep outside the ad/sub model, and surfacing per-use placement
  economics conflicts with streaming economics. → disincentivized to build
  downstream.
- **NCS / label-run free libraries:** a catalog + blanket license, run by
  humans, monetized via streaming royalties and sponsorships. No self-serve paid
  ad infra, no product placement, no per-use attribution graph, no automated
  ethos matching. Automating their own model would cannibalize their
  human-run sponsorship and sync relationships. → under-invest in the rail.
- **Podcast-ad networks:** human-driven, host-read, per-campaign negotiation,
  sold against a fixed host roster. They don't match *AI-run* channels by ethos,
  they don't do free-with-attribution instrumentation, and they can't settle
  micro-slots at scale. → won't build the automated marketplace.
- **DSPs / ad networks:** monetize their own inventory and demand; a neutral
  cross-channel attribution + settlement rail is outside their walled gardens. →
  disincentivized to build it.

Graham's *schlep blindness* still applies from the startup side: the unglamorous
attribution-tracking + verified-distribution + micro-settlement work is why the
vacuum persists — even now that both AI distribution and AI supply are
commoditizing.

## 4. The moat (Thiel's four, applied)

| Moat | Strength | Our edge |
|---|---|---|
| Proprietary tech | Weak → real but not primary | Embeddings and matching commoditize in months. Don't bet on them. |
| Economies of scale | Strong | Marginal cost to match listing #N ≈ 0 → we dominate long-tail placements, where human ad-sales and sync teams can't operate at cost. |
| Network effects | **Strongest** | The **attribution graph + verified distribution + settlement rail**: which channel's ethos matched which listing, what was used free, what was paid, what settled — cross-channel, cross-listing. Two-sided: more channels → more verified distribution → more suppliers → better ethos ground truth. Incumbents can't assemble it because each sees only one side (streaming OR labels OR their own ad inventory). |
| Brand | Secondary | As infrastructure, trust & claim discipline — not consumer brand — is what matters. |

**The bet to place:** becoming *the memory of what fit which channel's ethos,
what was used free, what was paid, and what settled — per channel, per listing,
per use.* The attribution graph is a data asset: every free use is labeled
data, every paid slot is a pricing template, and the flat settlement engine
becomes the standard for AI-distribution placement economics.

## 5. Build distribution into the product (Thiel)

- **Channel onboarding is beachhead + distribution + pricing leverage** — it is
  how we win a niche, generate ethos ground-truth, and brand the outcome.
- **The free tier is the supply + data channel.** Every free use with
  attribution is both distribution and a labeled data point; usage stats are
  the sales proof.
- **Settlement is a brand moment (Stripe-style).** Every x402 paid slot,
  payout, and flat split is a visible, verifiable event — proof-of-life that
  doubles as marketing.
- **Each channel is a distribution node.** Any AI-run channel, brand, or
  supplier that consumes the feed (or feeds listings into it) becomes a
  distribution node.
- **We are the best operator, not network-neutral.** Don't wait for rivals to
  plug into "neutral" rails. Win our own channels and suppliers, make the
  outcome valuable and cheap, and let incumbents consume it.

## 6. Beachhead → expand (phased plan)

1. **Schema** — unified `listing` (music/placement kinds), channels, free/paid
   flags, flat 3-way split. No bespoke consent policies, no versionPrograms, no
   multi-leg royalty waterfalls.
2. **Free tier** — one blanket click-through ToS at listing-creation and
   channel-registration; attribution string/link required on free placements.
3. **Ethos matching + channel onboarding** — verified distribution via public
   API; embed channel content description/history and listing tags/audio
   features into one vector space; cosine-match ethos → listing.
4. **Usage instrumentation** — record which channel used which listing, when,
   where; the data flywheel and the future sales proof.
5. **Paid tier ("ad infra")** — self-serve buy flow; channel or brand creates or
   accepts a paid slot, sets budget, flat-fee or CPM, checks out via Arc/x402;
   unique trackable attribution identifier per paid placement; flat
   supplier/channel/platform split.
6. **Spend cap** — campaign budget/spend cap stops serving once spent.
7. **Disclosure** — FTC/platform sponsored-content markers built into the
   paid-listing data model from day one.

Go/no-go by evidence on each side, not impressions:
- *Distribution:* real channels onboarded with verified reach; channels
  actually browse and use listings.
- *Supply:* music + product listings live; suppliers would repeat.
- *Usage:* free uses instrumented and attributed; **a channel picks a VERSIONS
  listing for its content over its usual source** (the thesis in miniature).
- *Paid:* ≥1 paid slot per side; flat split settles on Arc; spend cap works.

Interpretation: channels use free but nobody pays → the attribution graph is
the value, monetize downstream. Suppliers list but channels don't use → the
supply side needs a different distribution wedge. Both → proceed with the
combined marketplace. Neither → the narrative has attention value but not
market pull.

2. **Picks-and-shovels:** repeatable channel onboarding, then sell the
   primitive as an *outcome* to suppliers, brands, and distribution tools that
   are profitably mining but disincentivized to build — matched, attributed,
   settled placements.
3. **Expand (optional compaction of the rail):** abstract the
   settlement + attribution + verification rail beyond music and product
   placement — every agentic marketplace needs micro-settlement. Different,
   bigger company; earn the beachhead before abstraction.

## 7. Honest risks / caveats

- **Incumbents extend.** NCS could add a self-serve paid gate; podcast-ad
  networks could automate ethos matching; Spotify/UMG could push downstream.
  Mitigation: move fast on the cross-channel attribution + settlement graph;
  own the relationships (channels + suppliers) they route around.
- **Matching is metadata + audio features, not listening.** Until evaluation
  hears audio / watches video, "matched to ethos" is a weaker claim than
  "listened and approved." Gating workstream for scale.
- **Verification is public-API reach.** Real numbers, but reach ≠ engagement
  or monetization quality. Don't overclaim channel value.
- **Claim honesty.** "Settled" is only true for paid slots VERSIONS tracks and
  controls; free usage is instrumented and attributed, not settled. Overclaiming
  is an existential trust risk in a payments-and-attribution market.
- **Free tier as loss-leader trap.** The free tier is the wedge and the data
  flywheel, not a cost center — but if it never converts to paid, it's just
  free distribution. Watch the free→paid conversion.
- **Two-sided marketplace cold start.** Need both supply (listings) and
  distribution (channels) to make matching useful. Onboard one side concierge
  first; earn the right to open scale.
- **Attribution enforcement.** Free-use attribution is required but not legally
  guaranteed; the instrumentation is the evidence and the moat.
- **Focus.** "Rail for the whole agentic economy" is absent focus today. Win
  the AI-distribution placement beachhead first.

---

*History: the 2026-09 predecessor of this document framed the wedge as
"sync-licensing of authorized music versions" — per-track consent policies,
artist-authorized version programs, three-agent sync-fit scoring, and multi-leg
royalty waterfalls. That model was heavy (bespoke agreements, per-track
negotiation) and slow to convert. This pivot drops per-track licensing for an
NCS-style marketplace: one blanket agreement, free-with-attribution for organic
use, a self-serve paid/commercial gate, and music + product placement as the
same ethos-matched slot. The shipping rails (embeddings/matching, settlement +
Arc/x402, submission/upload + feed/discovery) are kept and repointed; the
consent-policy, version-program, and multi-leg-waterfall machinery is cut.*

*This file is the source of truth for product strategy. Do not duplicate
the reasoning in README.md — link here. Implementation: [docs/README.md](./docs/README.md).*

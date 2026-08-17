# VERSIONS — Strategy & Positioning

**Thesis.** VERSIONS is the **consent, curation, and settlement layer for
derivative music versions**. We win from a **wedge — one agentic primitive** —
positioned as **picks-and-shovels for the commercial end of AI music**:
*one rights-controlled song → a portfolio of artist-authorized versions →
ranked against real briefs → paid placements*, with per-version attribution
and micro-settlement on Arc USDC. Our moat is the compounding
**consent → lineage → fit → license → waterfall graph** + settlement
liquidity + zero-marginal-cost ranking scale.

> **Positioning statement**
> VERSIONS turns one rights-controlled song into a portfolio of authorized
> versions — ranked by agents against commercial briefs, approved by the
> artist, licensed with a complete rights package, and settled per version
> in micro-payments on Arc — and owns the cross-platform outcome graph no
> incumbent is building, because their money is in creation and streaming,
> not in the sync schlep.

---

## 1. What we are — and are not

- **We are** the automation of the sync *schlep* for **versions**: turning
  rights-controlled songs into ranked, license-ready version portfolios,
  and clearing, matching, and micro-attributing takes that human sync
  teams can't reach at cost.
- **We are not** a generation platform. Creation tools stay external and
  tool-agnostic — we never compete with the model layer.
- **We are not** a consumer remix feed. Since May 2026, Spotify/UMG own
  "fans make licensed AI covers, consumed on-platform." That lane is
  occupied; we don't enter it.
- **We are not** a catalog competing on library size. Size is an
  incumbents' game; we build the differentiated supply (authorized
  versions) and the conversion rail they won't.

## 2. The wedge: one agentic primitive, two supply paths

The primitive is the *autonomous brief → licensed-version pipeline*:

- paste a plain-English brief,
- three AI agents score versions by fit (Production / Performance /
  Market), producing an explainable `why_fits` verdict per take, with a
  configurable human gate,
- per-use micro-settlement on Arc USDC (x402 / ERC-8183 jobs, batched)
  with deterministic per-version attribution.

**Supply path A (running today):** catalog alternate takes — the original
long-tail story. Proven end-to-end on prod (brief search → license →
ERC-8183 job → USDC settlement), but dependent on catalog partners for
differentiated inventory, and rights remain unverified on this path.

**Supply path B (the new wedge):** artist-authorized versions — an artist
opts in with one rights-controlled song (master + composition), invited
creators produce derivatives under an explicit consent policy
(transformations, territories, term, splits, revocation), the artist
approves each take, agents + humans score, supervisors license. VERSIONS
owns the consent→lineage→approval→fit→license→waterfall graph for every
version. This path makes "pre-cleared" *actually true* — consent is
recorded per version before it can reach a brief.

We sell the **outcome** — pre-cleared, attributed, micro-settled licenses —
not a raw similarity API, not a creation tool, not a streaming surface.

### Honest capability gaps (pilot workstreams)

- **Agents currently score metadata, not audio** (`src/services/agents.ts`
  prompt: title/genre/mood/description). With AI-derived versions,
  creator-supplied metadata is untrustworthy input. Audio-aware
  evaluation (CLAP-style embeddings via `EMBEDDING_API_URL`, or extracted
  features fed to the agents) is a gating pilot workstream, not a
  follow-up.
- **Consent/policy schema is concierge-first.** The pilot runs on one
  lawyer-drafted agreement mirrored as a DB record + manual approval
  gates. The general schema (allowed transformations, territories,
  revocation, provenance, splits) is codified from that artifact.
- **No external virality ingestion yet.** "Verified audience response
  improves commercial matching" is the pilot hypothesis to test, not a
  shipped feature.

### Product expression: the supervisor decision workspace

The supervisor surface must present a **decision and an executable next
step**, not a catalog list with a score. For every recommendation, make the
matching evidence, the human approval gate, and the relevant license terms
legible in the workflow. The wallet and settlement rail remain proof and
execution infrastructure — never the front door.

Trust is part of the product. We show named agent verdicts, clearance
claims, and settlement status only when the corresponding result-level
evidence exists and is auditable. **Claim discipline:** "pre-cleared"
applies only to versions inside an authorized-version program; legacy
catalog results stay labeled rights-unverified. UI copy must not claim the
agents listened to audio until they do.

## 3. Why incumbents are disincentivized (updated for the post-May-2026 landscape)

The creation lane changed: **Spotify + UMG announced licensed fan-made
AI covers/remixes (2026-05-21)** — consent, credit, compensation,
discovery, on-platform. That validates the category and kills any thesis
built on "incumbents won't allow AI versions." It also tells us exactly
where NOT to compete.

What no incumbent is building — and why:

- **DSPs (incl. Spotify's new product):** consumer creation → on-platform
  consumption. Cross-platform **commercial conversion** (which authorized
  version fits this ad/trailer/game brief, packaged rights, per-use
  settlement) is a rights-heavy *schlep* outside the ad/sub model, and
  surfacing per-use royalty physics conflicts with streaming economics.
  → disincentivized to build downstream.
- **Labels / production-music catalogs:** derivative-version programs
  commoditize the curation premium and the human sync teams that justify
  the department; AI policy is internally contested. → under-invest.
- **Creation-tool vendors (Suno, ElevenLabs, …):** their incentive is
  generation volume; licensing correctness and auditability are costs,
  and they don't hold the artist/sync relationships. → won't build the
  conversion rail.

Graham's *schlep blindness* still applies from the startup side: the
unglamorous rights-packaging + commercial-matching work is why the vacuum
persists — even now that creation is commoditizing.

## 4. The moat (Thiel's four, applied)

| Moat | Strength | Our edge |
|---|---|---|
| Proprietary tech | Weak → real but not primary | AI models commoditize in months; generation is someone else's game. Don't bet on them. |
| Economies of scale | Strong | Marginal cost to rank version #N ≈ 0 → we dominate long-tail version portfolios, where human sync teams can't operate at cost. |
| Network effects | **Strongest** | The **consent → lineage → fit → license → waterfall graph**: which versions were permitted, which fit briefs, which actually licensed and settled — cross-platform, cross-artist. Two-sided: more artists → differentiated supply → more supervisors → better ground truth. Incumbents can't assemble it because each sees only one side (creation OR streaming OR catalog). |
| Brand | Secondary | As infrastructure, trust & claim discipline — not consumer brand — is what matters. |

**The bet to place:** becoming *the memory of what was consented, what fit,
and what licensed and settled — per version, per use.* The rights package
itself is a data asset: every pilot agreement becomes a template; the
waterfall engine becomes the standard for authorized-version economics.

## 5. Build distribution into the product (Thiel)

- **The supervisor surface is beachhead + distribution + pricing
  leverage** — it is how we win a niche, generate ground-truth, and brand
  the outcome.
- **Artist opt-in is the supply channel.** Each signed artist is both
  inventory and a reference; campaign results are marketing.
- **Settlement is a brand moment (Stripe-style).** Every x402 tip, payout,
  license job, and per-use royalty is a visible, verifiable event —
  proof-of-life that doubles as marketing.
- **Each integration is a channel.** Any catalog, label, sync tool, or
  creation tool that consumes the outcome (or feeds versions into it)
  becomes a distribution node.
- **We are the best operator, not network-neutral.** Don't wait for rivals
  to plug into "neutral" rails. Win our own pilots, make the outcome
  valuable and cheap, and let incumbents consume it.

## 6. Beachhead → expand (wedge to picks-and-shovels)

1. **Beachhead pilot (4–6 weeks, concierge — do not build the platform
   first):** one independent artist with a meaningful audience and one
   song where they control master + composition (no uncleared samples);
   8–15 invited creators using external tools; 3–5 working supervisors /
   creative directors evaluating against real briefs; one clean
   rights package; one paid use if possible. Generation stays external;
   VERSIONS verifies provenance/policy, records approvals, ranks, matches,
   settles. Go/no-go by evidence on each side, not impressions:
   - *Supply:* ≥10 policy-compliant versions, ≥30% artist-approved,
     artist would repeat.
   - *Demand:* ≥2 versions shortlisted against real briefs; ≥1 paid
     license/quote/procurement-level commitment; **a supervisor picks a
     VERSIONS version over their usual catalog choice** (the thesis in
     miniature).
   - *Ops:* complete lineage + signed permissions per version; rights
     review fast enough for commercial workflow; no disputes/takedowns;
     waterfall computable before money moves.
   Interpretation: artists engage but supervisors don't → fan-campaign
   business (different company). Supervisors engage but artists won't
   fund campaigns → authorized creation as catalog acquisition, monetize
   downstream. Both → proceed with the combined wedge. Neither → the
   narrative has attention value but not market pull.
2. **Picks-and-shovels:** repeatable artist campaigns, then sell the
   primitive as an *outcome* to catalogs/labels/sync tools that are
   profitably mining but disincentivized to build — pre-cleared,
   attributed, micro-settled version licenses.
3. **Expand (optional compaction of the rail):** abstract the
   settlement + attribution + verification rail beyond music — every
   agentic business needs micro-settlement. Different, bigger company;
   earn the beachhead before abstraction.

## 7. Honest risks / caveats

- **Creation-lane incumbents extend downstream.** Spotify/UMG could push
  from on-platform covers into commercial licensing of fan versions.
  Mitigation: move fast on the cross-platform conversion graph; own the
  relationships (artists + supervisors) they route around.
- **Audio-aware evaluation gap.** Agents judge metadata today; until they
  hear audio, "ranked by fit" on AI-generated versions is a weaker claim.
  Pilot workstream, gating for scale.
- **Rights complexity.** Voice/persona, composition, and master are
  separate rights with separate clearance paths. Pilot agreements must be
  counsel-drafted; the public story stays high-level, the contracts don't.
- **Claim honesty.** "Every play settles" is only true for uses VERSIONS
  tracks and controls; "pre-cleared" only inside authorized programs.
  Overclaiming is an existential trust risk in a rights-heavy market.
- **Commodity-API trap.** Selling raw brief→match recall is a commodity;
  always sell the *outcome* and the *graph*.
- **Three-sided marketplace cold start.** Pilot deliberately avoids open
  consumer uploads: invited creators only, one song, human approval gates.
  Moderation/fraud/impersonation become real problems only at open scale —
  earn the right to them.
- **Focus.** "Rail for the whole agentic economy" is absent focus today.
  Win the authorized-version sync beachhead first.

---

*History: the 2026-08 predecessor of this document framed the wedge as
"autonomous curation of the long tail of alternate takes" for sync. Weak
market pull at the Arc Demos & Meetup (supervisors found search without
dependable clearance/partial solution) plus the Spotify/UMG fan-covers
announcement (2026-05-21) drove the supply-wedge retarget above. The
primitive (brief → ranked version → license → Arc settlement) and all
shipping rails are unchanged; the demo catalog (17 ccMixter `demo` takes +
2 licensable `live` takes) remains the running proof of path A.*

*This file is the source of truth for product strategy. Do not duplicate
the reasoning in README.md — link here. Implementation: [docs/README.md](./docs/README.md).*

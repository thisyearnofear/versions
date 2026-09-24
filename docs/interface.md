# Interface & surface spec — the marketplace read

*Status: spec v1 · 2026-09-24. Companion to [STRATEGY.md](../STRATEGY.md)
(why we win) and [search.md](./search.md) (what the API returns). This file
owns **how the product looks and reads** — what every surface must say and
show, in what order, and what we refuse to do — so "it should feel like a
marketplace" stays a checkable contract instead of a taste debate.*

---

## 0. How to use this doc

- **§2 is the as-built inventory.** If you change a surface, update its row.
- **§3 is the diagnosis.** The five things that make the product read as an
  editorial site instead of a marketplace.
- **§4 is the spec.** Surface contracts, component grammar, onboarding
  ladder, copy discipline. New UI must satisfy the contract for its route.
- **§6 is the acceptance test.** A reviewer should be able to run it off a
  screenshot. If a change fails a box, it isn't done.

Status legend: **`as-built`** = shipped today · **`spec`** = required, not
built · **`decision`** = needs a product call before building.

---

## 1. Who we are designing for, and what they expect

**ICP (from [POSITIONING.md](../POSITIONING.md)):** the operator of an
ethos-curated distribution channel — lo-fi / study / morning-routine
YouTube automation first — who has an audience and no clean way to
monetize it. Not crypto-native. Runs 1–20 channels. Already shops for
supply in adjacent marketplaces, so they arrive with a **learned pattern**
they will apply to us in the first five seconds.

**Their reference set — and therefore our competition for recognition:**

| They know this | Its pattern we must match |
|---|---|
| NCS / Uppbeat / Epidemic Sound | Free-with-credit tier, one-line licence terms, instant download + credit text supplied |
| YouTube BrandConnect / Creator Marketplace | Brand deal inventory, verified channel numbers, disclosure built in |
| Amazon / Etsy / Gumroad | Shelf-first: facets, price on the card, seller identity, "Add" |
| Podcast ad networks | Self-serve slot buy: price, budget cap, no sales call |

**The expectation ladder — what they must be able to do, and how fast:**

| Window | Question in their head | What the surface must answer |
|---|---|---|
| 0–5s | "Is this for me?" | Who it's for, how much inventory, price band, that free exists |
| 5–30s | "Does it fit *my* channel?" | Personalization that needs **no account** |
| 30–90s | "Can I use something right now?" | One click to a usable asset + the credit line |
| 90s–5m | "Is this trustworthy / can I make money?" | Verified reach, settled legs, disclosure, 30% to the channel |
| 5m+ | "Make it mine" | Sign in, save, connect channel, wallet — **only now** |

**The one-sentence design goal:** the app must *recognize* as a
marketplace before the visitor reads a paragraph, and must deliver a
personally relevant result before the visitor meets a wallet.

---

## 2. Surface inventory (as-built)

Three doors, as mandated (`src/components/SiteHeader.tsx`): Browse
`/discover` · Supply `/submit` · Channels `/channels`. Public extras:
`/listings/:id` · `/placements/:slotId` · `/t/:code` · `/legal/agreement`.

| Surface | Files | Job today | Marketplace read | Gap |
|---|---|---|---|---|
| `/` Home | `src/app/page.tsx`, `src/components/home/LandingExperience.tsx` | Route each side; prove rails | **OK** | ✅ shelf line (`N listings live · N free with credit · N paid placements`) read from the API, ✅ `LiveDemoButton` remounted in the proof section, ✅ secondary CTA → `/discover#channel-probe`. Still open: price on the hero's featured match |
| `/discover` Browse | `src/app/discover/page.tsx`, `src/components/discovery/{MarketplaceBrowse,InventoryHeader,ChannelProbe}.tsx`, `src/components/marketplace/{PriceBadge,FitNote}.tsx` | Shop | **OK** | ✅ inventory header (`total` + pre-facet `counts`), ✅ server-side sort, ✅ price overlay badge in the first two card fields, ✅ prose-first `FitNote`, ✅ guest `ChannelProbe` with no auth. ✅ guest kit (`Add to kit` + `KitBar`). Still open: desktop facets rail, load-more cadence |
| `/listings/:id` | `src/app/listings/[id]/page.tsx`, `src/components/marketplace/BuyBox.tsx`, `PublishingKit.tsx` | Decide + act | **OK** | ✅ sticky price-first `BuyBox` (price headline + `PriceBadge` + campaign left + disclosure + 60/30/10 + ONE primary CTA) is the decision surface; ✅ `PublishingKit` de-prioritized to archival reference below the fold; ✅ tags + supplier are browse links; ✅ free `Copy credit — use it now` with toast + credit panel in the box; paid `Reserve/Buy` → placement pay step |
| `/channels` workspace | `src/components/channels/{ChannelWorkspace,ChannelEarnings}.tsx`, `src/app/api/v1/channels/[channelId]/earnings/route.ts`, `src/services/slots.ts:earningsForChannel` | Prove you get paid | **OK** | ✅ `ChannelEarnings` — `You keep 30%` from `SLOT_SPLITS`, settled vs pending from `slot_legs` on Arc, recent legs with tx links; ✅ non-owner explainer (`60/30/10` + `slot_legs` note, no amounts) |
| `/placements/:slotId` | `src/app/placements/[slotId]/page.tsx`, `src/components/placements/PlacementWorkspace.tsx` | Pay, run, report, settle | **Strong** | Best-built surface; voice is internal ("Payout status", "model", "accrued spend"); no stage rail; report form demands impressions/clicks the operator does not track |
| `/submit` Supply | `src/app/submit/page.tsx`, `src/components/supply/{SupplyPanel,SupplyCreator,SupplierListings}.tsx` | Create listing; manage; see activity | **Partial** | First-run supplier sees an empty state and a `0.50 USDC` upload toll before any value; no example to fork; two-column form + live preview is good |
| `/channels` | `src/app/channels/page.tsx`, `src/components/channels/{ChannelProbePanel,ChannelOnboarding}.tsx` | Connect + verify reach | **OK** | ✅ guest-first `ChannelProbePanel` first (paste URL/@handle + vibe → `browseHref({ q })`, no auth/wallet, `probe_run surface:channels`) sits above the fold; ✅ `Save & verify — make it yours` second with `you keep 30%` + `60/30/10 on Arc`, white inputs, `Save & verify →` CTA (`aria-label Save and verify`). Workspace at `/channels/[channelId]` remains the earnings surface |
| `/auth/signin` | `src/app/auth/signin/page.tsx`, `src/lib/auth.ts`, `src/components/wallet/WagmiConnectButton.tsx` | Identity | **Partial** | ✅ dead-thesis copy purged ("Channel access", marketplace promise, header tooltip). Open `decision`: still wallet-only (`Credentials({ name: "Wallet" })`) so the wedge persona meets a wallet before value |
| `/t/:code` | `src/app/t/[code]/route.ts` | 302 → attribution URL | OK | Keep; must stay unauthenticated and tracking-attributable |
| `/legal/agreement` | `src/app/legal/agreement/page.tsx`, `src/lib/agreement.ts` | The one blanket ToS | OK | Add a plain-language "what this means for you" block above the terms |

**Orphaned surfaces (verified: zero importers).** These exist, do nothing,
and mostly still speak the 2026-08 thesis — they confuse both readers and
agents:

| File | Note |
|---|---|
| ~~`src/components/home/LiveDemoButton.tsx`~~ | **The single best trust asset we have** (read-only walk of paid supply → delivery log → verified reach → settlement legs → attribution). **Remounted** on `/` (P0.3). |
| `src/components/home/HowItWorks.tsx` | 4-beat explainer, unmounted |
| `src/components/home/WedgeDiagram.tsx` | SVG pipeline explainer, unmounted |
| `src/components/home/WaveformGallery.tsx` | Unmounted |
| `src/components/home/SpectrumOrb.tsx` | Unmounted |
| `src/components/ui/PaginationControls.tsx` | Unmounted (Browse hand-rolls its own paging) |
| `src/components/audio/AudioPlayer.tsx` | Unmounted |
| `src/components/ui/Tour.tsx` | Mounted only in `SubmitForm.tsx`; copy rewritten to the marketplace ladder (P0.4) |
| `src/components/wallet/WalletGlossary.tsx` | Reachable only via `WagmiConnectButton showGlossary`, which no caller passes |

**Design system assets worth keeping.** `src/app/globals.css` tokens
(`--color-paper/ink/rust`, `--shadow-soft/lift`, `--radius-*`,
`--ease-out-expo`), the one-button grammar (`.btn-primary/secondary/ghost`,
44px targets), `.card-surface`, `.chip`, `.marketplace-kit`,
`.marketplace-grid`, `src/components/ui/primitives.tsx`
(`Container`/`Section`/`Eyebrow`/`Card`), `FadeIn`, `motion` grammar, and
the honest `statsSourceLabel` / `settlementLabel` / `by_reporter` habits.
The motion + reduced-motion discipline is a genuine differentiator — keep
it, it just shouldn't be the *first* thing a buyer sees.

---

## 3. Diagnosis — why it doesn't read as a marketplace

1. **The shell is a journal, not a shelf.** Paper `#f4efe5`, Fraunces
   serif body copy, mono micro-labels, `grain-overlay` + `vignette-overlay`
   pinned over everything (`src/app/layout.tsx`). Beautiful, and it says
   *read me*. A marketplace's first paint says *browse me*: inventory
   count, price, imagery, categories.
2. **Price is the least visible thing on the card.** In
   `MarketplaceBrowse.tsx` the card order is media → `MUSIC · free` →
   title → supplier → price (mono-12, `--color-ink-3`) → summary → tags →
   CTA. Price is field five at the lowest contrast. On Amazon/Etsy price
   is field two.
3. **Catalog chrome is missing.** No inventory header (`32 listings · 18
   music · 14 products` — the number the seed already guarantees), no sort
   (grep `sort` in `src/components/discovery/` → 0 matches), no free-only
   facet despite free being the wedge, no facets rail on desktop, no
   seller/supplier surface. Buyers scan; we make them read.
4. **The value loop ends in a clipboard.** Free use = copy
   `attribution_text` (`PublishingKit.tsx`), then separately "report where
   it ran" with a published URL + impressions + clicks
   (`UsageReporter.tsx`). There is no kit, no shortlist, no download
   bundle, no "this is now in my channel kit". Nothing the buyer *did*
   stays in the product, so nothing feels like shopping.
5. **Auth cliff before first value.** Identity is a wallet signature
   (`src/lib/auth.ts`) and every valuable action (connect channel,
   personalize browse, reserve, report) sits behind it. The wedge persona
   is a media operator; a RainbowKit modal at the moment they want to
   "paste my channel URL" is a cold stop. Browse personalization is
   auth-gated: guests get `mode: recent`.
6. **The persuasive assets are unreachable.** `LiveDemoButton`,
   `HowItWorks`, `WedgeDiagram` — the three things that would make the
   abstract claims concrete — are dead code (§2). Meanwhile `Tour.tsx`,
   which *is* reachable, still describes the deleted thesis. Stale copy is
   not just cosmetic: it makes a disciplined product look unfinished,
   which is the opposite of the trust story we sell.

---

## 4. The updated surface spec

### 4.1 Principles (M1–M6)

- **M1 — Inventory before manifesto.** Every entry surface states what is
  on the shelf before it explains what the shelf is.
- **M2 — Price is a first-class citizen.** Every listing shows a price
  badge (or `Free`) in the first two visual fields, at body-text weight.
- **M3 — Personal relevance before identity.** A visitor gets a
  channel-shaped result with no account. Auth is requested for
  *persistence* and *money*, never for *seeing fit*.
- **M4 — One primary action per decision surface.** One filled button
  (`.btn-primary`) per page-level decision point — hero, buy box, form
  footer. A repeated grid of listing cards *is* the shelf, so its per-card
  CTA may be primary; everywhere else use `.btn-secondary`.
- **M5 — Commerce verbs, marketplace nouns.** `Browse`, `listing`,
  `price`, `use`, `buy`, `budget`, `delivered`, `paid out`. No
  `supervisor`, `brief`, `license`, `agent`, `shortlist`.
- **M6 — Claim discipline is part of the look.** `verified` /
  `platform_api` / `settled` / `by_reporter` / `#ad` render exactly as
  specified in [STRATEGY.md](../STRATEGY.md) §2 and `search.md`
  "Required invariants". Never soften them for looks.

### 4.2 Surface contracts (target)

Each row is binding. "Above fold" assumes a 13" laptop viewport.

| Surface | Job | Above fold must contain | Primary CTA | Secondary | Auth gate | Proof on surface |
|---|---|---|---|---|---|---|
| `/` | Route each side; prove rails | H1 naming the marketplace; inventory count + price band + "free with credit"; 2 CTAs | `Browse the catalog` | `Paste your channel URL → see what fits` | none | `N listings live` · last-settled strip with tx hash |
| `/discover` | Shop | Inventory header (counts by kind + tier + slice), search, kind/tier/**free-only** facets, sort | Per-card `Use free` / `Buy this placement` | `Add to kit` | none (channel context optional) | `why_fits` note · trust row · fit hidden behind words |
| `/listings/:id` | Decide | Media gallery + sticky `BuyBox` (price headline + budget left + disclosure + credit) | `Copy credit — use it now` / `Buy this placement` (one, full-width) | `Add to kit` | at reserve/pay only | disclosure + `60/30/10 on Arc` + supplier + blanket agreement · full `PublishingKit` reference below the fold |
| `/placements/:slotId` | Run + settle | Stage rail (`Reserved → Paid → Live → Delivered → Settled`), current stage, amount | Stage-appropriate (`Pay & activate` / `Finish & settle`) | `Pause delivery` | owner-only | legs with tx hashes · delivery history with reporter split |
| `/submit` | Stock the shelf | Two lanes (`List a track` / `List a product`); free-first terms; live preview | `List it — free` | `See an example listing` | yes (identity) | attribution preview · what you earn on paid |
| `/channels` | Verify reach | Paste-URL field **first**; what unlocking gets you; what you keep | `See what fits this channel` (no auth) | `Save & verify →` (auth) | at save/verify | `platform-verified` badge · numbers + source + verified date |
| `/legal/agreement` | One read | Plain-language 5-bullet summary | `Accept & continue` | full terms | none | version stamp |

### 4.3 Component grammar (build these once, use everywhere)

Explicit field order — this is the discipline that makes the catalog read
as a marketplace.

- **`InventoryHeader`** (`src/components/discovery/InventoryHeader.tsx`) —
  `N listings` headline, then the slice line
  `“32 in this slice · 18 music · 14 products · 21 free · 11 paid”`, then the
  ranking label. Two distinct numbers on purpose: the headline is the
  post-facet `total` the pager pages over, the breakdown is the API's
  **pre-facet** `counts` (so a facet never collapses the other groups).
  Never invented in the client.
- **`PriceBadge`** (`src/components/marketplace/PriceBadge.tsx`) — the one
  price shape on cards: `Free · credit required` / `3.00 USDC flat` /
  `4.50 USDC CPM`, overlaid on the media so it lands in the first two
  visual fields.
- **`FitNote`** (`src/components/marketplace/FitNote.tsx`) — `Fits: <tags>`
  in prose; the raw score is a `title` affordance only, never the headline.
- **`ListingCard`** — exact order:
  1. Media, cover-cropped (`object-cover`), play affordance for `music`.
  2. **`PriceBadge`** — `Free · credit required` or `3.00 USDC flat` /
     `4.50 USDC CPM` / `Campaign remaining 42.00 USDC`.
  3. Title (link, full card click target).
  4. Supplier — a link to that supplier's listings.
  5. **`FitNote`** — prose first: `Fits: late-night focus, instrumental`.
     Show the raw score only on hover/expand, never as the headline.
  6. **`TrustRow`** — small: verified badge when applicable, disclosure
     chip for paid, `added <relative time>`.
  7. `Use free` / `Buy this placement` + `Add to kit`.
- **`BuyBox`** (`src/components/marketplace/BuyBox.tsx`) — the decision surface on `/listings/:id`. Sticky on `≥lg`, price is the headline (field 1), not the footnote. Price headline + `PriceBadge` + `campaign left` + disclosure chip + `60/30/10 on Arc` economics line (paid) + channel picker (`Run on`) + CPM budget escrow input + ONE full-width primary CTA (`Copy credit — use it now` / `Buy this placement` / `Reserve this slot`) + `Add to kit` secondary + credit-to-render panel (free) + collapsed `Log where it ran` (free, post-publish). `Blanket agreement` last. **Replaces** `ListingActions.tsx` (deleted) — the old clipboard-first surface. Never invents a price; badge + headline both read `listingPriceBadge(listing)` / `listing.pricing.*`.
- **`ChannelEarnings`** (`src/components/channels/ChannelEarnings.tsx`, `src/app/api/v1/channels/[channelId]/earnings/route.ts`, `src/services/slots.ts:earningsForChannel`) — `You keep 30%` from `SLOT_SPLITS` (`60/30/10 supplier/channel/platform`), settled vs pending from `slot_legs` where `recipient_role = 'channel'` on `slots.channel_id = :id`, recent legs with Arc tx links (`txUrl`/`shortHash`) or `View placement` fallback. Owner-only amounts (route 404's non-owners); non-owner sees the split explainer without amounts. Empty state: "No paid placements have settled — first paid use will produce a channel leg you can verify here."
- **`KitBar`** (`src/components/marketplace/KitBar.tsx`, store `src/lib/kit.ts`,
  binding `src/lib/use-kit.ts`) — persistent, guest-capable (localStorage,
  cross-tab), `Add to kit` on cards and listing pages: count,
  `Copy credits` (free lines only), `Export .txt`, expandable shortlist with
  `Reserve →` on paid rows. **Copying a credit is not a use** and the bar says
  so; a paid listing carries **no** credit in the kit — the `#ad` attribution
  is issued to the channel when the slot is bought, and `sanitizeKitItem`
  enforces that so a hand-edited localStorage entry can't smuggle one in.
- **`ChannelProbe`** — paste URL → derive vibe text → rank. **No write, no
  auth.** Save/verify is the follow-on CTA.
- **`StageRail`** — reuse the reach/journey idea from the dead
  `JourneyRail`, with marketplace stages and no `Brief`/`License`.

### 4.4 Onboarding ladder — ICP-native, guest-first

| Rung | Action | Surface | Auth | Succeeds when |
|---|---|---|---|---|
| 1 | Recognize | `/` above fold | none | Visitor can say "marketplace for tracks + brand placements for channels" |
| 2 | Taste fit | `ChannelProbe` on `/` → `/discover?q=` | none | First page is ranked to their vibe |
| 3 | Take something | Listing → `Use free` → `Add to kit` → credit + media + `Export .txt` | none | They leave with an asset, a credit line, and a kit that survives reload |
| 4 | Persist | `Save kit`, `Save channel` | sign-in (email/Google **or** wallet) | Their kit/channel survives reload |
| 5 | Transact | Reserve → pay → report → settle | wallet (money only) | A slot settles and the receipt is readable |

Rung 3 is the missing rung today. Rung 4 is where wallet-only identity
costs us the wedge persona — **`decision`:** add a non-wallet identity
provider to `src/lib/auth.ts` so the wallet is a payment credential, not
the front door.

### 4.5 Copy discipline

**Banned (dead-thesis residue; delete on sight):** supervisor, brief,
license/licensing, agent/agents, shortlist, curator, listener, "earn on
play", "10 free plays daily". **Purged 2026-09-24** —
`src/app/auth/signin/page.tsx` (was "Supervisor access"),
`src/components/wallet/WagmiConnectButton.tsx` (was the same tooltip),
`src/components/ui/Tour.tsx` (was the whole file),
`src/components/ui/JourneyRail.tsx` (deleted). Re-introducing any of these is
a review blocker.

**Required vocabulary:** Browse · listing · track · product placement ·
free with credit · buy a placement · flat fee · CPM · budget cap · budget
remaining · disclosure · verified reach · channel-reported · platform-verified ·
delivered · paid out · 60/30/10 · Arc.

**Label rules:** a label must be the buyer's word, not our model's word.
`Attribution — render this credit exactly as written` is right. `Publishing
kit`, `Payout status`, `Model: flat` are ours; prefer `What to publish`,
`Where the money went`, `Flat fee`.

**One-line licence clarity.** Somewhere above the fold on every listing:
what it costs, what you must render, who gets paid. Three short clauses.

### 4.6 Visual system — keep, add, stop

- **Keep:** token palette, type pairing, radius scale, shadow scale, one
  ease curve, 44px targets, reduced-motion coverage, focus ring,
  `.card-surface` / `.chip` / `.btn-*` grammar, the honest badges.
- **Add:** a **price/inventory layer** (badges, count headers) and
  **density** — `.marketplace-grid` should reach 4 columns ≥1400px with a
  tighter gap; mobile keeps 1 → 2.
- **Add:** image-forward cards. Music: cropped generated cover + waveform.
  Products: first image as hero, `object-cover` (today `ListingMedia`
  letterboxes with `object-contain` and falls back to a text tile).
- **Add:** exactly one dark, high-contrast surface per page maximum — the
  buy box or the proof strip. Today `marketplace-stage` on `/` is the only
  one and it's showing a *demo*, not a *price*.
- **Stop:** putting `grain-overlay`/`vignette-overlay` (z-index 1–2) over
  commerce surfaces; simplify to the paper tone on `/discover`, listing,
  and placement pages so cards and prices sit on the cleanest possible
  background.
- **Stop:** inventing one-off mono-9px/10px caps in components — use
  `Eyebrow` / `.marketplace-label` / `primitives.tsx`.

### 4.7 Instrumentation

Extend the existing `track(...)` vocabulary (`src/lib/analytics.ts`) so
the marketplace read is measurable, not asserted. New names must be added
to the `AnalyticsEvent` union in that file first — it is a closed union and
typecheck fails otherwise:

- ✅ `probe_run` `{ surface, has_handle }` — shipped (rung 2 without auth)
- ✅ `slot_intent { listingId, tier, action: use|buy }` — shipped on the card CTA
- ✅ `kit_add` / `kit_remove` / `kit_copy` / `kit_export` / `kit_clear` —
  shipped (rung 3 completion)
- `auth_prompt_shown` `{ surface, reason }` — how often we demand a wallet
  before value (target: 0 on `/discover`, `/listings/:id`)
- keep `supply_created`, `channel_registered`, `demo_run`

---

## 5. Migration plan

**P0 — the marketplace read + guest trial — ✅ shipped 2026-09-24**

1. ✅ **Guest `ChannelProbe`** on `/discover` + the `/` hero secondary CTA:
   paste URL/handle → compose `q` → `?q=` deep-link. No
   `POST /api/v1/channels`, no auth. *Files:*
   `src/components/discovery/ChannelProbe.tsx`, `MarketplaceBrowse.tsx`,
   `LandingExperience.tsx`.
2. ✅ **Browse chrome:** `InventoryHeader` + `PriceBadge` + `FitNote` +
   server-side sort; card reorder per §4.3. Sort and facet `counts` are a
   small additive API change (`sort` + `counts` on
   `GET /api/v1/marketplace/search`) — a client-side sort over one page
   would have been a lie. *Files:* `src/services/marketplace.ts`,
   `src/app/api/v1/marketplace/search/route.ts`, `src/lib/marketplace-client.ts`,
   `MarketplaceBrowse.tsx`.
3. ✅ **Proof remounted:** `LiveDemoButton` on `/` proof section; hero states
   the shelf (`N listings live · N free with credit · N paid placements`)
   from the API's `counts`.
4. ✅ **Stale copy purged:** `auth/signin/page.tsx`, `WagmiConnectButton.tsx`
   title, `Tour.tsx` rewritten, `JourneyRail.tsx` deleted.
5. **`decision` — still open:** non-wallet sign-in in `src/lib/auth.ts`
   (email/Google) with wallet retained for payment. This is the last thing
   standing between the wedge persona and rung 4.

**P1 — the shopping loop — BuyBox + channel earnings + guest-first /channels shipped 2026-09-24**

6. ✅ `BuyBox` on `/listings/:id` — sticky price-first decision surface; single CTA per tier; clipboard panel de-prioritized to archival reference below the fold. *Files:* `src/components/marketplace/BuyBox.tsx`, `src/app/listings/[id]/page.tsx`; **deleted** `src/components/marketplace/ListingActions.tsx`.
7. ✅ `KitBar` (guest localStorage, cross-tab) + `Copy credits` / `Export .txt` + expandable shortlist. Only free credit lines ship; paid rows stay a shortlist with `Reserve →`.
8. ✅ Channel earnings — `You keep 30%` from `SLOT_SPLITS`, settled vs pending from `slot_legs` on Arc, owner-only amounts, public split explainer. *Files:* `src/components/channels/ChannelEarnings.tsx`, `src/app/api/v1/channels/[channelId]/earnings/route.ts`, `src/services/slots.ts:earningsForChannel`.
9. Media treatment: cover-cropped cards + play affordance (music), hero image (placements) — still open.
10. Supplier identity: make the supplier name link to `/discover?supplier=` (minimum) — **partial** (listing page supplier + tags now link to `/discover?q=` / `?kind=`; browse filter still by `q`).
11. ✅ `/channels` guest-first — `ChannelProbePanel` first (`See what fits this channel` → `browseHref({ q })`, no auth), `Save & verify — make it yours` second with `you keep 30%` + `60/30/10` + `Save & verify →` (white inputs, `aria-label Save and verify`). *Files:* `src/app/channels/page.tsx`, `src/components/channels/ChannelProbePanel.tsx`, `src/components/channels/ChannelOnboarding.tsx`.

**P2 — polish + de-orphan**

12. `StageRail` on `/placements/:slotId` + marketplace voice in
    `PlacementWorkspace`.
13. Simplify `UsageReporter` defaults (impressions/clicks optional with
    honest `channel-reported` labelling; never infer platform-verified).
14. Supply first-run: waive or absorb the `0.50 USDC` upload toll for a
    first marketplace listing; add a forkable example listing.
15. Desktop facets rail; keep chips on mobile.
16. Delete `WaveformGallery`, `SpectrumOrb`, `PaginationControls`,
    `AudioPlayer`; resolve `HowItWorks` / `WedgeDiagram` /
    `WalletGlossary` (remount or remove); keep the three doors.

---

## 6. Acceptance checklist — "does it read as a marketplace?"

- [ ] Above the fold on `/`: what's for sale, how many, price band, that
      free-with-credit exists.
- [ ] A first-time visitor gets a channel-shaped result **without** signing
      in or connecting a wallet.
- [ ] Every listing card shows price (or `Free`) in its first two fields,
      at body weight or better.
- [ ] `/discover` states inventory totals and offers sort + kind + tier +
      free-only.
- [ ] Every listing page has one primary CTA and one price in the buy box.
- [x] A guest can end a session holding something: a kit + credit line +
      media links (free credits only; paid rows stay un-credited until reserved).
- [ ] No surface asks for a wallet before it offers value.
- [ ] New UI contains none of the banned vocabulary (§4.5).
- [ ] `verified`, `platform_api`, `settled`, `by_reporter`, `#ad` render
      per claim discipline; mock/demo rows are labelled.
- [ ] Exactly one `.btn-primary` per decision surface (page header / buy box /
      form footer); the repeated grid CTA is exempt by design (§4.1 M4).
- [ ] No orphaned explainer components; every mounted surface speaks the
      current thesis.

## 7. Anti-patterns (do not regress)

- No wallet at the front door; no auth before relevance.
- No listing that launches into a clipboard and ends there.
- No price hidden behind a click, a tooltip, or a mono-9px label.
- No second catalog product: music and placements stay **one primitive**,
  one grid, one card ([STRATEGY.md](../STRATEGY.md) §2).
- No new nav doors; three doors only.
- No generation surface, no consumer remix feed, no per-listing bespoke
  terms.
- No softening of claim discipline for visual neatness.
- No `mock`/`channel`-reported numbers presented as verified — aggregates
  keep the `by_reporter` split.

---

*Strategy: [STRATEGY.md](../STRATEGY.md) · Positioning:
[POSITIONING.md](../POSITIONING.md) · API contract:
[primitive-api.md](./primitive-api.md) · Browse/search internals:
[search.md](./search.md) · Beachhead:
[beachhead.md](./beachhead.md)*

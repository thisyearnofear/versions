# VERSIONS — Beachhead Bootstrapping (Step 4)

Goal: turn the moat from *code* into *data* — get real humans (not the team)
labeling `(brief → take)` matches, curate one coherent vertical slice, and
snapshot the benchmark baseline that later justifies the semantic/CLAP
upgrade (Step 5).

This is a **do-things-that-don't-scale** play: hand-curate a slice, hand-recruit
a handful of supervisors/A&R people, and let their taps build the ground-truth
set. See `STRATEGY.md` §6 for the strategic context.

---

## 1. Pick one vertical slice (win a niche)

Choose **one genre × one mood** and make the catalog coherent in that slice
first. Recommended starting slice (already represented in our seed data):

> **Tense / thriller — including "car chase" and "no vocals, ~120 bpm" briefs**

Why this slice:
- It's what our seeded placements already cover (`car chase`, `tense`, etc.), so
  the catalog is non-empty on day one.
- It's a concrete, easily-pitched use case (a trailer / action sequence) that a
  sync person instantly understands.

Action: seed/dedup the catalog so ~20–50 published takes fit this slice, each
with a real `placement_brief` (scene tags, instruments, emotional arcs, tempo).

## 2. Recruit 3–5 real labelers (outreach template)

Target: indie sync teams, ad-agency music supervisors/music producers, and
filmmaker/licensor folks — people who actually run briefs.

> **Subject:** 15 minutes to test a sync search tool
>
> Hi [First name],
>
> We're building a tool that turns a music brief written in plain English
> ("tense car chase, no vocals, ~120 bpm") into ranked, license-ready
> alternate takes — rated by AI agents, settling per-play on-chain, no wallet
> needed to search.
>
> We'd love 15 minutes of your eye. Two asks:
> 1. Run one of your real briefs through the search at [URL] and tell us
>    whether the top 5 would clear a sync pitch.
> 2. For each result, tap **Good fit / Wrong fit** — that's the exact signal
>    we use to make the matcher better. No sign-up.
>
> In exchange: first look + we tune the slice to your catalogue. Happy to do
> it on a call if that's easier.
>
> — [You], VERSIONS

Priority order: a warm connection first (best signal), then a mix of 2–3 from
different sides (sync house, ad, film) so the labels aren't from one viewpoint.

## 3. Capture the labels (two paths, both feed the same benchmark)

- **Primary — in-app:** supervisors tap **Good fit / Wrong fit** on the
  Discover result cards (wired to `/api/v1/discover/brief/feedback`). Zero
  friction, no sign-up (guest identity).
- **Secondary — batch / hand-curated:** for anything you (or a labeler) want to
  record offline, use the curation tool. A starter set for the tense-chase slice
  is checked in — run it to seed ground truth before labelers arrive:
  ```bash
  npm run curate -- --set data/labels/beachhead-starter.labels.json
  ```
  (Seed the catalog first so the `demo-published-*` takes exist:
  `npm run seed`.)
  ```json
  [
    { "brief": "tense car chase, no vocals, ~120 bpm", "submissionId": "demo-published-0002-0000-000000000002", "verdict": "good_fit" },
    { "brief": "tense car chase, no vocals, ~120 bpm", "submissionId": "demo-published-0005-0000-000000000005", "verdict": "good_fit" },
    { "brief": "tense car chase, no vocals, ~120 bpm", "submissionId": "demo-published-0006-0000-000000000006", "verdict": "wrong_fit" }
  ]
  ```

  `CURATOR_WALLET` sets the curation identity (defaults to a stable dev wallet).

## 4. Success metrics (what "it's working" means)

- **≥ 3 external labelers** who run a real brief (not the team).
- **≥ 100 labeled `(brief → take)` outcomes** across ≥ 5 distinct briefs.
- **A benchmark baseline snapshot** you can move month-over-month:

  ```bash
  npm run benchmark
  ```
  Watch **MRR / precision@1** (is the good take surfacing high?) and
  **score discrimination** (do *good* labels score higher than *wrong* — i.e.,
  is `fit_score` actually predictive?).
- **1–2 external parties say the top-5 would clear a pitch** — qualitative
  proof the outcome is license-ready, not just a list.

## 5. Checklist (do-things-that-don't-scale)

- [ ] Seed ~20–50 takes into the chosen slice with real `placement_briefs`.
- [ ] Manually verify each seeded brief returns sensible ranked matches.
- [ ] Send the outreach template to the 3–5 targets; book the warm connection first.
- [ ] Walk each person through the search + **Good/Wrong fit** once (record it).
- [ ] Run `npm run benchmark` → save the baseline.
- [ ] Curate ~20 hand labels offline with `npm run curate` to seed the set before labelers arrive.
- [ ] After 2–3 labelers, re-run the benchmark; decide on Step 5 (semantic) *by the data*.
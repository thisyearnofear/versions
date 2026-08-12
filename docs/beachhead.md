# Beachhead

Turn the moat from code into **labeled data**: real supervisors marking
`(brief → take)` as good/wrong fit.

Slice to win first: **tense / thriller** (car chase, no vocals, ~120 bpm).
Seed 20–50 coherent takes. Recruit 3–5 people who actually run briefs.

**In-app:** Good fit / Wrong fit on Discover → `/api/v1/discover/brief/feedback`.  
**Batch:** `npm run seed` then
`npm run curate -- --set scripts/labels/beachhead-starter.labels.json`.

Success: ≥3 external labelers, ≥100 labels across ≥5 briefs, and a
benchmark you can move month-over-month (`npm run benchmark` — watch MRR
and precision@1). Strategy: [STRATEGY.md](../STRATEGY.md) §6.

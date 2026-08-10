# Live Baseline — 2026-08-10

Match ground-truth benchmark captured against **real Neon** (Postgres 18.4,
`neondb`, pooled connection). This is the month-over-month baseline the
beachhead playbook (`docs/beachhead.md` §4) compares future runs against.

## Environment

- Database: Neon `neondb` · Postgres 18.4 · pgvector enabled
- Schema: `drizzle/0000` + `0001` + `0002` (23 tables, complete ledger in
  `drizzle.__drizzle_migrations`)
- Seed: 8 submissions · 7 published versions · 7 placement briefs ·
  35 settlement legs · 1 A&R playlist (7 tracks)
- Adapters: `arc.mock` / `llm.mock` / `embedding.mock` / `gateway.mock` /
  `ipfs.unconfigured` — no external keys wired; mock-first as designed
- Primitive version: `v1` (see `docs/primitive-api.md`)

## Wedge walk (live, over HTTP)

Brief: `tense car chase, no vocals, ~120 bpm`

1. `match` — 2 ranked takes, #1 **Neon Dreams — Luna Rivera** (fit 4.75)
2. `verdict` — `good_fit` recorded
3. `license` — `pending_payment` · $250.00 USDC · `sync_tv_film`
4. `settle` — `paid` (mock) tx `0x88beaaa090…`
5. `benchmark` — see below

## Benchmark report

```
queries:            1
judgments:          2
good / wrong fits:  2 / 0  (good fraction 100.0%)

MRR:                1.000
rank of 1st good:   #1.00
precision@1:        100.0%
precision@3:        100.0%
precision@5:        100.0%
nDCG@3:             1.000
nDCG@5:             1.000
fit score good/wrong: 4.75 / (no data)  (Δ n/a)
```

## How to regenerate

```bash
npm run db:pgvector   # if the schema was dropped (DROP SCHEMA drops the extension)
npm run db:migrate    # no-op if the ledger is complete
npm run seed
npm run dev &
npm run primitive:demo
npm run benchmark
```

## Notes

- Judgments = 2 because `primitive:demo` was run twice (initial partial run
  + the completed loop); both are `good_fit` on the same top-ranked take, so
  MRR / precision stay at 1.0. A clean single-run baseline is judgments = 1.
- The orphan `pending_payment` license from the partial run remains in the
  DB; harmless until real settlement is wired.

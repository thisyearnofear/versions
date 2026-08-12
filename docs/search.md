# Search

Supervisors paste a brief (3–500 chars). Results are ranked takes with
`fit_score` and `why_fits`.

**Always on:** structured-tag overlap (scene, instruments, mood, tempo).

**When embeddings are live** (`OPENROUTER_API_KEY` or `EMBEDDING_API_URL`):
pgvector cosine neighbors, hybrid score (semantic 0.7 + tags 0.3).
OpenRouter embeds **catalog text** (title + placement brief), not raw
audio. Set `EMBEDDING_API_URL` for CLAP audio vectors.

```bash
npm run db:pgvector
curl -X POST http://localhost:3000/api/v1/embeddings/backfill
```

Fail-open: missing pgvector / empty table / API error → tag-only ranking.

Ground-truth taps (good/wrong fit) feed the benchmark: `npm run benchmark`.
See [beachhead.md](./beachhead.md) and [primitive-api.md](./primitive-api.md).

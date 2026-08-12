# Supervisor Decision Workspace

VERSIONS search is not a catalog browser. It is the supervisor-facing start
of the autonomous **brief → licensed-track** primitive: a person describes a
scene, receives an accountable recommendation with supporting evidence, makes
the approval decision, and can open the appropriate license workflow.

Search remains guest-friendly. A wallet is never required to receive useful
matches or contribute match feedback; it is required only for authenticated
shortlisting and licensing.

## Current experience

A brief is 3–500 characters. `GET /api/v1/discover/brief` returns ranked
published takes with a `fit_score` and up to three `why_fits` citations.
`DiscoverView` presents the top result as a recommendation, keeps a compact
list for supervisor comparison, and exposes these current, evidence-backed
states:

- **Match evidence:** `why_fits` identifies matching placement-brief metadata
  such as a scene, instrument, emotional arc, or audience-summary hit.
- **Human gate:** supervisors listen and confirm the opening, vocal space, and
  edit point against picture. VERSIONS does not manufacture a false
  creative-risk verdict when the scorer has not produced one.
- **License terms:** an authenticated supervisor can review the available
  usage, territory, term, and server-derived price, then open a pending
  license job.
- **Ground truth:** a visible good-fit / wrong-direction judgment records the
  shown brief, rank, and score. That feedback feeds the match benchmark and
  later scorer tuning.

`rating_count` is a count of curator reviews. It is never presented as a
three-agent consensus.

## Honest ranking evidence

**Always on:** structured-tag matching over scene, instruments, emotional
arcs, and audience summary.

**When embeddings are live** (`OPENROUTER_API_KEY` or
`EMBEDDING_API_URL`): pgvector cosine neighbors combined with structured
signals (semantic weight 0.7; structured weight 0.3). OpenRouter embeds
catalog text (title plus placement brief), not raw audio. Set
`EMBEDDING_API_URL` for CLAP audio vectors.

```bash
npm run db:pgvector
curl -X POST http://localhost:3000/api/v1/embeddings/backfill
```

If pgvector, embeddings, or the embedding provider are unavailable, search
fails open to structured-tag ranking.

The current result contract does **not** contain individual Production,
Performance, and Market-agent runs, nor result-level clearance evidence.
The UI therefore calls its disclosure **ranking evidence**, not an agent
trace, and uses “available to request” rather than “pre-cleared” or
“license-ready.” See the next section for the contract required to make
those stronger claims.

## Required contract for the full agentic workspace

Before named-agent or clearance states can appear, a future version of the
match contract must return auditable result-level fields:

- `ranking_run`: run ID, scorer/model version, elapsed time, and the ranking
  mechanisms actually used;
- `agent_verdicts`: only for agents that actually ran — per-agent score,
  confidence, evidence, and an objection or trade-off where available;
- `clearance`: rights status, scope, restrictions, and a stable proof or
  reference;
- `license_quote`: applicable usage, territory, term, price, and the next
  executable action; and
- `alternate_take_relationship`: how a selected take differs from related
  masters or alternate performances.

With those fields, the experience can group **recommended / strong
alternatives / needs human review** and show outcome-backed agent decisions.
It must never infer them from a generic rank, elapsed browser time, or a
curator-review count.

## Product progression

1. **Now:** a recommendation, evidence, human gate, feedback capture, and
   in-context license terms.
2. **Next:** actual per-result agent decision records and clearance/quote
   evidence; show ranking movement when a supervisor refines the brief.
3. **Then:** supervisor-configured approval thresholds, budget, and rights
   policies so the system can prepare the correct license job autonomously
   while the human retains the consequential approval.

Ground-truth taps (`good_fit` / `wrong_fit`) feed the benchmark:
`npm run benchmark`. The versioned external primitive is documented in
[primitive-api.md](./primitive-api.md); the strategic rationale is in
[`STRATEGY.md`](../STRATEGY.md).

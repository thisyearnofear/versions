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
  Inline `why_fits` chips (top 2) render below title/artist in the collapsed
  row; hover-to-play (200ms debounced) auto-plays a snippet from the audio.
- **Version families:** results sharing a `family_id` are grouped — the
  best match renders as the primary row; siblings are expandable via a
  chevron toggle showing "N versions in this family". Each sibling renders
  a full MatchRow with snippet playback, scoring, shortlisting, and licensing.
- **Agent scoring:** audio features (tempo, key, energy, loudness) are
  extracted from each audio file at publish time and included in agent
  prompts. Three-tier extraction: remote CLAP/ONNX endpoint → local ONNX
  chromagram (BPM, key, energy, loudness) → ffmpeg probe. When features are
  absent, the prompt notes: "rating based on metadata only."
- **Human gate:** supervisors listen and confirm the opening, vocal space, and
  edit point against picture. VERSIONS does not manufacture a false
  creative-risk verdict when the scorer has not produced one.
- **Catalog provenance:** every result identifies `catalog.source` as
  `demo` or `live`, while the response reports the returned-catalog mode and
  result counts. Current seed data is a **guided demo**: its sample takes are
  for evaluating matching and feedback, not rights offers.
- **Requestability and quote:** live-catalog takes may be
  `license_availability.status: "requestable"` and carry a server-derived,
  `indicative` global schedule. Demo takes are `demo_preview` with a `sample`
  schedule only; they never open a license job, payment, or settlement.
- **Clearance disclosure:** every current result explicitly reports
  `clearance.status: "unverified"`. Publication, a wallet, a MusicBrainz ID,
  a placement brief, and curator-review counts are not rights clearance.
- **Consent lineage (authorized versions):** when `catalog.source` is
  `"authorized"`, a `ConsentLineagePanel` renders below the match row
  showing the full consent → lineage → approval → audio features → agent
  scores → settlement waterfall graph. This makes the moat visible: who
  authorized what, what tools were used, what splits are in place, and what
  the agents scored from actual audio.
- **Ground truth:** a visible good-fit / wrong-direction judgment records the
  shown brief, rank, and score. That feedback feeds the match benchmark and
  later scorer tuning.

`rating_count` is a count of curator reviews. It is never presented as a
three-agent consensus.

## Honest ranking and licensing evidence

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

The current result contract includes a real workflow state and quote schedule:
`requestable` means the take is published and accepted by the existing
`POST /licenses` workflow; `indicative` means the platform generated the
schedule from its server-side pricing source. It still has no rights-holder,
opt-in authority, chain-of-title, scope restriction, revocation, or
clearance-proof record. The UI therefore calls its disclosure **ranking
evidence**, labels rights as **unverified**, and never says “pre-cleared” or
“license-ready.”

## Required contract for the full agentic workspace

Before named-agent or verified-clearance states can appear, a future version
of the match contract must return auditable result-level fields:

- `ranking_run`: run ID, scorer/model version, elapsed time, and the ranking
  mechanisms actually used;
- `agent_verdicts`: only for agents that actually ran — per-agent score,
  confidence, evidence, and an objection or trade-off where available;
- a verified `clearance`: rights status, scope, restrictions, and a stable
  proof or reference that can replace today’s `unverified` state;
- a `license_quote` with a quote source, per-track override or negotiated
  terms, and a final/expired state when applicable; and
- `alternate_take_relationship`: how a selected take differs from related
  masters or alternate performances.

With those fields, the experience can group **recommended / strong
alternatives / needs human review** and show outcome-backed agent decisions.
It must never infer them from a generic rank, elapsed browser time, or a
curator-review count.

## Product progression

1. **Now:** a provenance-aware recommendation, evidence, human gate, demo
   feedback capture, and a non-binding guided demo. Live takes can expose
   requestability plus an indicative server-derived quote, always with an
   explicit unverified-clearance disclosure.
2. **Next:** actual per-result agent decision records, rights attestations,
   verification, and quote evidence; show ranking movement when a supervisor
   refines the brief.
3. **Then:** supervisor-configured approval thresholds, budget, and rights
   policies so the system can prepare the correct license job autonomously
   while the human retains the consequential approval.

Ground-truth taps (`good_fit` / `wrong_fit`) feed the benchmark:
`npm run benchmark`. The versioned external primitive is documented in
[primitive-api.md](./primitive-api.md); the strategic rationale is in
[`STRATEGY.md`](../STRATEGY.md).

# Guided demo, usage proof & billing seams

## Current product boundaries

### Brief→license (legacy, kept)

- `demo` is guided-demo seed for brief→rank→feedback. `live` is catalog for the supervisor workflow. Demo cannot create licenses/jobs/settlements. This marker does **not** assert clearance.

### Marketplace (the wedge)

- `listings`: `music` (requires an owned `submission`) or `placement` (own images). `tier: free | paid`, paid `flat | cpm`, optional `budget_cap_usdc`, `disclosure` mandatory on paid / forbidden on free, `attribution_text`/`attribution_url` generated.
- `channels`: real distribution only. `verification_status: pending | verified | failed`, `stats_source: platform_api | mock`. Only `verified && active` → `can_buy_slots`.
- `slots`: paid placements (`pending_payment → active → exhausted|completed`); flat settles 3-leg `60/30/10` at pay, CPM escrows budget and settles accrued spend at `complete` with refund.
- `usage_events`: every use logged. `reported_by: channel | platform_api | manual` — aggregates must show the split; `spend_usdc` written only by `slots.accrue`.

## Settlement safety

Both settlement rails (legacy licenses + slot legs) share the same
fail-closed pattern: **claim before money moves** via `settlement_lease_id`
(`pending_payment → settling` guarded by `WHERE lease IS NULL`, second
caller gets 409, a thrown payment leaves the lease held for explicit
reconciliation). Campaign spend (`listings.budget_spent_usdc`) is
reserved/released atomically; delivery spend (`slots.spent_usdc` via
`accrue`) is capped atomically in the `WHERE` clause — no spend from
the request body, no channel writing `spendUsdc`, no self-reported reach
unlocking `can_buy_slots`.

Retention (`POST /api/cron/sweep`, `RETENTION_*_DAYS`) never touches money tables or unprocessed outbox rows.

## Subscription / billing hypothesis

The paid side is **ad infra** — revenue is paid placements against the
free wedge. The first pricing question is whether a channel will pay a
flat fee/CPM that actually settles to all three parties, not whether a
supervisor will pay to click. A plausible tier test:

| Tier | Intended value |
|---|---|
| Free supply | Browse, use with attribution, every use logged |
| Paid placement | Flat or CPM, tracking code, disclosure, budget cap, 60/30/10 settlement |
| Campaign (future) | Rolling cap across a supplier's listings with pooled spend |

Pricing, cap windows, tax treatment, and which catalog charges what remain product decisions. Paid placement must not be described as buying rights clearance.

## Future relayer seam

When usage evidence supports it, a relayer can remove repetitive wallet
prompts without custody — a bounded authorization (operation class, cap,
expiry, policy), sponsor-bound execution, and the same receipt. Needs a
pricing decision, compliance review, revocation semantics, and idempotency.
The platform stays noncustodial.

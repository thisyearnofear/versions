# Guided demo, live catalog, and billing seams

## Current product boundary

The catalog is explicitly sourced per published take:

- `demo` is deterministic guided-demo data. It is for testing the brief → ranked match, listening, refinements, and fit feedback loop.
- `live` is catalog data intended for the live supervisor workflow. This source marker does **not** assert clearance, ownership, authority, or a final license offer.

Search returns row-level `catalog` provenance and a response-level `catalog` summary (`guided_demo`, `live_catalog`, or `mixed`). Demo matches display an illustrative usage schedule and a non-binding license-flow preview. They cannot create licensing interests, licenses, ERC-8183 jobs, Arc USDC payments, or settlements. The server enforces this boundary as well as the UI.

Feedback records the source snapshot alongside each verdict. The production match benchmark only uses `live` feedback, while demo feedback remains available for product/UX analysis without training or measuring the live catalog ranking.

## Settlement safety

A license settlement has an owner-bound claim before ERC-8183 or Arc work begins. A second click cannot take over that claim, and a failed request does not automatically reopen it: an external executor may already have accepted a job or payout. A `settling` row should be refreshed before any retry; if it persists, operations must reconcile the job and transfer receipts, then either finalize the original claim or prove no external side effect occurred before releasing it. This is intentionally fail-closed against duplicate payouts until durable executor idempotency and an operator reconciliation workflow are implemented.

## Subscription hypothesis

The first pricing question is whether a supervisor will pay for faster, more confident decisions—not whether they will pay to click through a wallet prompt. A plausible tier test is:

| Tier | Intended value |
|---|---|
| Guided demo | Free matching, listening, refinements, and demo feedback |
| Team subscription | A monthly allowance for live-catalog search/scoring, shared briefs/shortlists, and workflow reporting |
| Usage overage | Clearly priced, supervisor-approved operations beyond the included allowance |

Pricing, allowances, tax treatment, and which actions are chargeable remain product decisions. A subscription must not be described as buying rights clearance or guaranteeing a license.

## Future relayer seam

When product evidence supports it, a relayer can remove repetitive wallet prompts without taking custody:

1. A supervisor approves a bounded authorization for a specific operation class, budget cap, expiry, and catalog/rights policy.
2. The application records the approved intent and submits eligible work to a relayer or account-abstraction sponsor.
3. The relayer batches or sponsors execution only within that authorization; anything outside it requires fresh supervisor approval.
4. The ordinary receipt remains attached to the license/job outcome: approved intent, final terms, transaction or sponsored-operation reference, and settlement state.

This is deliberately a seam rather than an implementation today. It needs a concrete pricing decision, jurisdictional/compliance review, revocation and spend-limit semantics, idempotency, and a provider selection. The platform should remain noncustodial: it must never hold a supervisor’s assets or present a sponsored operation as an executed license without the appropriate authorization and result-level rights evidence.

-- Money-path integrity: repeat-report guard + payment idempotency.
--
-- 1. uq_usage_dedup — one use of a listing on a specific piece of content is
--    one row. Without it a retried report drew a CPM budget down again, which
--    made an untrusted reporter able to spend a supplier's campaign budget at
--    will. Partial on external_content_id because an organic use with no
--    external id has nothing stable to deduplicate on.
-- 2. uq_slots_payment_idempotency + the payment_idempotency_key column — lets a
--    retried payment replay its original receipt instead of failing
--    SLOT_NOT_PAYABLE. Complementary to settlement_lease_id: the lease guards
--    concurrent callers, this makes a legitimate retry idempotent.
ALTER TABLE "slots" ADD COLUMN IF NOT EXISTS "payment_idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_slots_payment_idempotency"
  ON "slots" ("payment_idempotency_key")
  WHERE "payment_idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usage_dedup"
  ON "usage_events" ("listing_id", "channel_id", "external_content_id", "occurred_at")
  WHERE "external_content_id" IS NOT NULL;

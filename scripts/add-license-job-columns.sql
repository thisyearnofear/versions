-- Add ERC-8183 job receipt columns to licenses (idempotent).
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS job_status TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS deliverable_hash TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS job_create_tx_hash TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS job_complete_tx_hash TEXT;

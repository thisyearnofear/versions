-- Migration: Add Audius/Solana fields for Hackathon
-- Track: Music (Audius) - "Versions of a song as tickets"

-- Add Audius integration fields to versions
ALTER TABLE versions ADD COLUMN audius_track_id TEXT;
ALTER TABLE versions ADD COLUMN audius_artist_id TEXT;

-- Add Solana ticket/coin ownership fields
ALTER TABLE versions ADD COLUMN artist_coin_address TEXT;  -- Solana token address for ticket
ALTER TABLE versions ADD COLUMN is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE versions ADD COLUMN ticket_price_usd REAL DEFAULT 0.0;

-- Create index for coin lookups
CREATE INDEX IF NOT EXISTS idx_versions_coin_address ON versions(artist_coin_address);
CREATE INDEX IF NOT EXISTS idx_versions_audius_track ON versions(audius_track_id);

-- Create table for tracking version ownership (simplified for demo)
CREATE TABLE IF NOT EXISTS version_tickets (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    coin_address TEXT NOT NULL,
    purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_version ON version_tickets(version_id);
CREATE INDEX IF NOT EXISTS idx_tickets_wallet ON version_tickets(wallet_address);

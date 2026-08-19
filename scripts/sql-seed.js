#!/usr/bin/env node
// Minimal script to run SQL against Neon DB for authorized demo seed.
// Usage: node scripts/sql-seed.js

require('dotenv').config({ path: ['.env', '.env.local'] });
const { Pool } = require('pg');

// Use an existing user wallet address to satisfy FK constraint
const ARTIST_WALLET = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sql = `
-- 1. Version program
INSERT INTO version_programs (id, rights_holder_wallet, source_title, source_artist, consent_policy, splits, status)
VALUES (
  'pilot-demo-0001',
  '0x0000000000000000000000000000000000000001',
  'Midnight Chromatics',
  'Elena Voss',
  '{"allowed_transformations":["alt_vocals","remix","mood_flip","tempo_shift"],"prohibited":["use_in_advertising","defamatory_context"],"territories":["worldwide"],"term_months":12,"revocable":true,"model_training_allowed":false,"notes":"Demo consent policy for Arc Demos & Meetup — synthetic rights holder.","agreement_ref":"docs/pilot-agreement-draft.md"}'::jsonb,
  '[{"wallet":"0x0000000000000000000000000000000000000001","label":"rights_holder","share_bps":4000},{"wallet":"0x0000000000000000000000000000000000000002","label":"creator","share_bps":3000},{"wallet":"0x0000000000000000000000000000000000000003","label":"publisher","share_bps":2000},{"wallet":"0x0000000000000000000000000000000000000004","label":"platform","share_bps":1000}]'::jsonb,
  'active'
) ON CONFLICT (id) DO UPDATE SET status = 'active';

-- 2. Submissions
INSERT INTO submissions (id, artist_wallet, title, artist_name, version_type, genre, artist_mood, description, audio_path, audio_size_bytes, content_type, fee_quote_usdc, program_id, authorization_status, authorized_at, lineage, status, rating_count, submitted_at)
VALUES
  ('sub-authorized-0001', '${ARTIST_WALLET}', 'Midnight Chromatics (Original)', 'Elena Voss', 'studio', 'ambient electronic', '"dark cinematic"', '"Original studio take"', 'uploads/authorized-demo-0.mp3', 480000, 'audio/mpeg', '0.50', 'pilot-demo-0001', 'approved', NOW(), NULL, 'published', 0, NOW()),
  ('sub-authorized-0002', '${ARTIST_WALLET}', 'Midnight Chromatics (Alt Take)', 'Elena Voss', 'alt_take', 'ambient electronic', '"melancholic spacious"', '"Alt take — slower, deeper, more reverb"', 'uploads/authorized-demo-1.mp3', 480000, 'audio/mpeg', '0.50', 'pilot-demo-0001', 'approved', NOW(), '{"creator_tools":["elevenlabs-music"],"source_version_ids":["original-midnight-chromatics"],"notes":"Alt take from same source program"}'::jsonb, 'published', 0, NOW())
ON CONFLICT (id) DO UPDATE SET program_id = 'pilot-demo-0001', authorization_status = 'approved', lineage = COALESCE(EXCLUDED.lineage, submissions.lineage);

-- 3. Published versions
INSERT INTO published_versions (submission_id, artist_wallet, title, artist_name, version_type, audio_path, rating_count, catalog_source, published_at, family_id)
VALUES
  ('sub-authorized-0001', '${ARTIST_WALLET}', 'Midnight Chromatics (Original)', 'Elena Voss', 'studio', 'uploads/authorized-demo-0.mp3', 0, 'authorized', NOW(), 'midnight-chromatics-family'),
  ('sub-authorized-0002', '${ARTIST_WALLET}', 'Midnight Chromatics (Alt Take)', 'Elena Voss', 'alt_take', 'uploads/authorized-demo-1.mp3', 0, 'authorized', NOW(), 'midnight-chromatics-family')
ON CONFLICT (submission_id) DO UPDATE SET catalog_source = 'authorized', family_id = 'midnight-chromatics-family';

-- 4. Agent reviews
INSERT INTO agent_reviews (id, submission_id, agent_name, curator_wallet, solo_intensity, vocal_quality, energy_vs_studio, tempo_feel, mood_tags, notes, raw_response, submitted_at)
VALUES
  ('sub-authorized-0001-production', 'sub-authorized-0001', 'production', '${ARTIST_WALLET}', 7, 6, 'same', 'locked', '["dark","cinematic"]', 'Clean mix with good separation', '{}', NOW()),
  ('sub-authorized-0001-performance', 'sub-authorized-0001', 'performance', '${ARTIST_WALLET}', 7, 6, 'same', 'locked', '["dark","cinematic"]', 'Strong emotional arc', '{}', NOW()),
  ('sub-authorized-0001-market', 'sub-authorized-0001', 'market', '${ARTIST_WALLET}', 8, 5, 'same', 'locked', '["ambient","electronic"]', 'Fits sync brief well', '{}', NOW()),
  ('sub-authorized-0002-production', 'sub-authorized-0002', 'production', '${ARTIST_WALLET}', 6, 7, 'same', 'locked', '["melancholic","spacious"]', 'Warm analog texture', '{}', NOW()),
  ('sub-authorized-0002-performance', 'sub-authorized-0002', 'performance', '${ARTIST_WALLET}', 8, 6, 'same', 'locked', '["melancholic","spacious"]', 'Deliberate pacing works', '{}', NOW()),
  ('sub-authorized-0002-market', 'sub-authorized-0002', 'market', '${ARTIST_WALLET}', 7, 5, 'same', 'locked', '["ambient","electronic"]', 'Good alternative take', '{}', NOW())
ON CONFLICT DO NOTHING;

-- 5. Update agent review details
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, submission_id, agent_name FROM agent_reviews WHERE agent_name IN ('production', 'performance', 'market') LOOP
    UPDATE agent_reviews SET
      detail = jsonb_build_object(
        'fit_score', CASE WHEN r.agent_name = 'production' THEN 7 WHEN r.agent_name = 'performance' THEN 7 ELSE 8 END,
        'metric', CASE WHEN r.agent_name = 'production' THEN 6 WHEN r.agent_name = 'performance' THEN 6 ELSE 7 END,
        'metric_label', CASE WHEN r.agent_name = 'production' THEN 'mix clarity' WHEN r.agent_name = 'performance' THEN 'vocal delivery' ELSE 'placement recall' END,
        'note', CASE WHEN r.agent_name = 'production' THEN 'Clean mix with good separation' WHEN r.agent_name = 'performance' THEN 'Strong emotional arc' ELSE 'Fits sync brief well' END
      ),
      fit_score = CASE WHEN r.agent_name = 'production' THEN 7 WHEN r.agent_name = 'performance' THEN 7 ELSE 8 END
    WHERE id = r.id;
  END LOOP;
END $$;

-- 6. Settlement legs
INSERT INTO settlement_legs (id, submission_id, recipient_wallet, recipient_role, amount_usdc, status, created_at)
VALUES
  ('sub-authorized-0001-leg-artist', 'sub-authorized-0001', '0x0000000000000000000000000000000000000001', 'artist', '0.20', 'settled', NOW()),
  ('sub-authorized-0001-leg-creator', 'sub-authorized-0001', '0x0000000000000000000000000000000000000002', 'creator', '0.15', 'settled', NOW()),
  ('sub-authorized-0001-leg-publisher', 'sub-authorized-0001', '0x0000000000000000000000000000000000000003', 'publisher', '0.10', 'settled', NOW()),
  ('sub-authorized-0001-leg-platform', 'sub-authorized-0001', '0x0000000000000000000000000000000000000004', 'platform', '0.05', 'settled', NOW()),
  ('sub-authorized-0002-leg-artist', 'sub-authorized-0002', '0x0000000000000000000000000000000000000001', 'artist', '0.20', 'settled', NOW()),
  ('sub-authorized-0002-leg-creator', 'sub-authorized-0002', '0x0000000000000000000000000000000000000002', 'creator', '0.15', 'settled', NOW()),
  ('sub-authorized-0002-leg-publisher', 'sub-authorized-0002', '0x0000000000000000000000000000000000000003', 'publisher', '0.10', 'settled', NOW()),
  ('sub-authorized-0002-leg-platform', 'sub-authorized-0002', '0x0000000000000000000000000000000000000004', 'platform', '0.05', 'settled', NOW())
ON CONFLICT DO NOTHING;

-- 7. Verify
SELECT 'programs: ' || count(*) FROM version_programs WHERE id = 'pilot-demo-0001';
SELECT 'submissions: ' || count(*) FROM submissions WHERE program_id = 'pilot-demo-0001';
SELECT 'published: ' || count(*) FROM published_versions WHERE catalog_source = 'authorized' AND family_id IS NOT NULL;
`;

pool.query(sql, (err, result) => {
  if (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
  console.log('\n\x1b[1m\x1b[32m✅ Seed complete!\x1b[0m\n');
  
  // Print verification results
  if (result.rows) {
    for (const row of result.rows) {
      const [key, val] = Object.entries(row)[0];
      console.log(`  ${key}: ${val}`);
    }
  }
  
  console.log(`
  \x1b[1mGo to https://versions.persidian.com/discover and search:\x1b[0m
    "dark ambient cinematic electronic"
  
  You should see:
    - \x1b[32mConsentLineagePanel\x1b[0m with program, splits, lineage
    - \x1b[36mVersion family grouping\x1b[0m (expandable siblings)
    - Agent scores from chromagram-extracted audio features
  
  \x1b[33mNote: Synthetic demo data with fake wallet addresses.\x1b[0m
`);
  pool.end();
});
-- MODULAR: Move 3 — generated waveform-cover per track.
-- The cover is computed in the browser (decodeAudioData →
-- peak extraction → SVG path) and submitted as part of the
-- submission metadata. Stored in submissions.cover_svg and
-- mirrored to published_versions.cover_svg at publish time.
--
-- The cover is what makes the feed feel like a record
-- store: each take has a unique 1:1 visual identity
-- derived from the audio itself. No user-uploaded art
-- needed.
--
-- ORGANIZED: cover_svg is a TEXT column. An SVG with 64
-- bars is < 4KB. No need for a separate blob store.
-- CLEAN: a missing cover is fine — the feed row falls
-- back to the radar if cover_svg is null.

ALTER TABLE submissions ADD COLUMN cover_svg TEXT;
ALTER TABLE published_versions ADD COLUMN cover_svg TEXT;

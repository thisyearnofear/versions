-- MODULAR: agent_reviews — AI agent curator reviews.
-- DRY: each agent writes one row per submission. The curation service
--      reads from here when computing the publish gate.
-- CLEAN: agent_name is constrained to the three known agents. The
--        raw_response column stores the full LLM output for debugging
--        and audit; the parsed fields are the source of truth for the
--        taste graph.
--
-- ENHANCEMENT FIRST: agent_reviews mirrors the ratings table schema
-- so the curation service can UNION both when computing the publish
-- threshold and taste-graph aggregation.

CREATE TABLE agent_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  agent_name TEXT NOT NULL
    CHECK (agent_name IN ('production','performance','market')),
  curator_wallet TEXT NOT NULL,
  solo_intensity INTEGER NOT NULL CHECK (solo_intensity BETWEEN 1 AND 10),
  vocal_quality INTEGER NOT NULL CHECK (vocal_quality BETWEEN 1 AND 10),
  energy_vs_studio TEXT NOT NULL
    CHECK (energy_vs_studio IN ('lower','same','higher')),
  tempo_feel TEXT NOT NULL
    CHECK (tempo_feel IN ('dragging','locked','rushing')),
  mood_tags TEXT NOT NULL,
  notes TEXT,
  raw_response TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (submission_id, agent_name)
);

CREATE INDEX idx_agent_reviews_submission ON agent_reviews(submission_id);

-- MODULAR: placement_briefs — the Market Agent's career guidance output.
-- DRY: one brief per submission. JSON columns for structured lists
-- (venues, channels, influencers, draft emails) so the web client
-- renders them without server-side parsing.
--
-- The brief is the premium deliverable. The artist can copy the draft
-- emails and send them directly. Each venue/channel/influencer entry
-- is a JSON object with { name, reason, contact_info? }.

CREATE TABLE placement_briefs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  agent_name TEXT NOT NULL DEFAULT 'market',
  venues TEXT NOT NULL,
  youtube_channels TEXT NOT NULL,
  influencers TEXT NOT NULL,
  draft_emails TEXT NOT NULL,
  audience_summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_placement_briefs_submission ON placement_briefs(submission_id);

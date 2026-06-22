// MODULAR: Agent service. Orchestrates multi-agent review pipeline.
// DRY: each agent writes to agent_reviews (audit) + ratings (publish gate).
//      The curation service reads ratings as usual — no changes needed there.
// CLEAN: agents auto-claim and auto-rate without wallet signatures (server-side
//        operator wallets). The settlement service pays agent wallets on publish.
// ENHANCEMENT FIRST: reuses the existing ratings table and publish threshold
//                    from curation.js. Agent reviews are additive, not parallel.

'use strict';

const crypto = require('crypto');

const { openDb } = require('../db');
const { aggregateRatings } = require('./taste-graph');

const PUBLISH_THRESHOLD = 3;

const AGENT_NAMES = ['production', 'performance', 'market'];

const SYSTEM_PROMPTS = {
  production: `You are a music production critic specializing in audio quality, mix, and mastering.
Analyze the track metadata and provide a structured review.
Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of production feedback>"
}`,

  performance: `You are a performance critic specializing in vocal delivery, instrumental feel, and emotional impact.
Analyze the track metadata and provide a structured review.
Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of performance feedback>"
}`,

  market: `You are a music industry analyst specializing in market fit, audience targeting, and placement strategy.
Analyze the track metadata and provide a structured review AND a placement brief.
Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of market analysis>",
  "placement_brief": {
    "venues": [{"name": "...", "reason": "...", "contact": "..."}],
    "youtube_channels": [{"name": "...", "reason": "...", "followers": "..."}],
    "influencers": [{"name": "...", "reason": "...", "platform": "..."}],
    "draft_emails": [{"to": "...", "subject": "...", "body": "..."}],
    "audience_summary": "<1-2 sentences>"
  }
}`
};

function buildUserPrompt(submission) {
  return `Review this track submission:

Title: ${submission.title}
Artist: ${submission.artist_name}
Version type: ${submission.version_type}
Genre: ${submission.genre || 'unspecified'}
Mood: ${submission.mood || 'unspecified'}
Description: ${submission.description || 'none provided'}
Audio duration: ${submission.audio_duration_seconds || 'unknown'}s
MusicBrainz ID: ${submission.musicbrainz_id || 'none'}

Provide your structured review as JSON.`;
}

function parseAgentResponse(text, agentName) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch (_) { parsed = null; }
    }
  }

  if (!parsed) return null;

  const solo = Math.max(1, Math.min(10, Math.round(Number(parsed.solo_intensity) || 5)));
  const vocal = Math.max(1, Math.min(10, Math.round(Number(parsed.vocal_quality) || 5)));
  const energy = ['lower', 'same', 'higher'].includes(parsed.energy_vs_studio) ? parsed.energy_vs_studio : 'same';
  const tempo = ['dragging', 'locked', 'rushing'].includes(parsed.tempo_feel) ? parsed.tempo_feel : 'locked';
  const moodTags = Array.isArray(parsed.mood_tags)
    ? parsed.mood_tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 10)
    : [];
  const notes = typeof parsed.notes === 'string' ? parsed.notes.slice(0, 2000) : '';

  const result = {
    solo_intensity: solo,
    vocal_quality: vocal,
    energy_vs_studio: energy,
    tempo_feel: tempo,
    mood_tags: moodTags,
    notes
  };

  if (agentName === 'market' && parsed.placement_brief && typeof parsed.placement_brief === 'object') {
    result.placement_brief = parsed.placement_brief;
  }

  return result;
}

function createAgentService({ llm, settlement, agentWallets }) {
  const db = openDb();

  const insertAgentReviewStmt = db.prepare(`
    INSERT INTO agent_reviews (
      id, submission_id, agent_name, curator_wallet,
      solo_intensity, vocal_quality, energy_vs_studio, tempo_feel,
      mood_tags, notes, raw_response
    ) VALUES (
      @id, @submission_id, @agent_name, @curator_wallet,
      @solo_intensity, @vocal_quality, @energy_vs_studio, @tempo_feel,
      @mood_tags, @notes, @raw_response
    )
  `);

  const insertRatingStmt = db.prepare(`
    INSERT OR IGNORE INTO ratings (
      id, submission_id, curator_wallet,
      solo_intensity, vocal_quality, energy_vs_studio, tempo_feel,
      mood_tags, notes
    ) VALUES (
      @id, @submission_id, @curator_wallet,
      @solo_intensity, @vocal_quality, @energy_vs_studio, @tempo_feel,
      @mood_tags, @notes
    )
  `);

  const insertClaimStmt = db.prepare(`
    INSERT OR IGNORE INTO curator_claims (id, submission_id, curator_wallet, expires_at)
    VALUES (?, ?, ?, ?)
  `);

  const incrementRatingCountStmt = db.prepare(`
    UPDATE submissions SET rating_count = rating_count + 1 WHERE id = ?
  `);

  const insertBriefStmt = db.prepare(`
    INSERT OR REPLACE INTO placement_briefs (
      id, submission_id, venues, youtube_channels, influencers,
      draft_emails, audience_summary
    ) VALUES (
      @id, @submission_id, @venues, @youtube_channels, @influencers,
      @draft_emails, @audience_summary
    )
  `);

  const insertPublishedStmt = db.prepare(`
    INSERT INTO published_versions (
      submission_id, artist_wallet, title, artist_name, version_type,
      audio_path, musicbrainz_id, cover_svg,
      avg_solo_intensity, avg_vocal_quality, energy_consensus, tempo_consensus,
      aggregated_mood_tags, rating_count, published_at
    ) VALUES (
      @submission_id, @artist_wallet, @title, @artist_name, @version_type,
      @audio_path, @musicbrainz_id, @cover_svg,
      @avg_solo_intensity, @avg_vocal_quality, @energy_consensus, @tempo_consensus,
      @aggregated_mood_tags, @rating_count, @published_at
    )
  `);

  const markPublishedStmt = db.prepare(`
    UPDATE submissions
    SET status = 'published', published_at = datetime('now')
    WHERE id = ?
  `);

  async function reviewSubmission(submissionId) {
    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
    if (!sub) return { ok: false, error: 'Submission not found' };
    if (sub.status === 'published') return { ok: false, error: 'Submission already published' };
    if (!['awaiting_curation', 'in_curation'].includes(sub.status)) {
      return { ok: false, error: `Cannot review submission in status ${sub.status}` };
    }

    const reviews = [];
    let brief = null;

    for (let i = 0; i < AGENT_NAMES.length; i++) {
      const agentName = AGENT_NAMES[i];
      const wallet = agentWallets[i];

      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      insertClaimStmt.run(crypto.randomUUID(), submissionId, wallet, expiresAt.toISOString().replace('T', ' ').slice(0, 19));

      const result = await llm.complete({
        system: SYSTEM_PROMPTS[agentName],
        user: buildUserPrompt(sub),
        agentName,
        genre: sub.genre || 'rock',
        versionType: sub.version_type || 'live'
      });

      const parsed = result.parsed || parseAgentResponse(result.text, agentName);
      if (!parsed) {
        console.warn(`[agents] ${agentName} returned unparseable response, using fallback`);
        const fallback = llm.mock
          ? llm.MOCK_TEMPLATES?.[agentName]?.getReview(sub.genre || 'rock', sub.version_type || 'live')
          : null;
        if (!fallback) continue;
        parsed = fallback;
      }

      const reviewId = crypto.randomUUID();
      const ratingId = crypto.randomUUID();

      insertAgentReviewStmt.run({
        id: reviewId,
        submission_id: submissionId,
        agent_name: agentName,
        curator_wallet: wallet,
        solo_intensity: parsed.solo_intensity,
        vocal_quality: parsed.vocal_quality,
        energy_vs_studio: parsed.energy_vs_studio,
        tempo_feel: parsed.tempo_feel,
        mood_tags: JSON.stringify(parsed.mood_tags),
        notes: parsed.notes,
        raw_response: result.text
      });

      insertRatingStmt.run({
        id: ratingId,
        submission_id: submissionId,
        curator_wallet: wallet,
        solo_intensity: parsed.solo_intensity,
        vocal_quality: parsed.vocal_quality,
        energy_vs_studio: parsed.energy_vs_studio,
        tempo_feel: parsed.tempo_feel,
        mood_tags: JSON.stringify(parsed.mood_tags),
        notes: parsed.notes
      });

      incrementRatingCountStmt.run(submissionId);

      reviews.push({
        id: reviewId,
        agent_name: agentName,
        curator_wallet: wallet,
        solo_intensity: parsed.solo_intensity,
        vocal_quality: parsed.vocal_quality,
        energy_vs_studio: parsed.energy_vs_studio,
        tempo_feel: parsed.tempo_feel,
        mood_tags: parsed.mood_tags,
        notes: parsed.notes,
        mock: result.mock
      });

      if (agentName === 'market' && parsed.placement_brief) {
        const pb = parsed.placement_brief;
        insertBriefStmt.run({
          id: crypto.randomUUID(),
          submission_id: submissionId,
          venues: JSON.stringify(pb.venues || []),
          youtube_channels: JSON.stringify(pb.youtube_channels || []),
          influencers: JSON.stringify(pb.influencers || []),
          draft_emails: JSON.stringify(pb.draft_emails || []),
          audience_summary: pb.audience_summary || ''
        });
        brief = {
          venues: pb.venues || [],
          youtube_channels: pb.youtube_channels || [],
          influencers: pb.influencers || [],
          draft_emails: pb.draft_emails || [],
          audience_summary: pb.audience_summary || ''
        };
      }
    }

    const refreshed = db.prepare('SELECT rating_count FROM submissions WHERE id = ?').get(submissionId);
    let published = null;

    if (refreshed.rating_count >= PUBLISH_THRESHOLD) {
      published = await tryPublish(submissionId);
    }

    return { ok: true, reviews, brief, rating_count: refreshed.rating_count, published };
  }

  async function tryPublish(submissionId) {
    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
    if (!sub || sub.status === 'published') return { alreadyPublished: true };

    const ratings = db.prepare('SELECT * FROM ratings WHERE submission_id = ?').all(submissionId);
    const agg = aggregateRatings(ratings);

    const publishTx = db.transaction(() => {
      insertPublishedStmt.run({
        submission_id: sub.id,
        artist_wallet: sub.artist_wallet,
        title: sub.title,
        artist_name: sub.artist_name,
        version_type: sub.version_type,
        audio_path: sub.audio_path,
        musicbrainz_id: sub.musicbrainz_id,
        cover_svg: sub.cover_svg,
        avg_solo_intensity: agg.avg_solo_intensity,
        avg_vocal_quality: agg.avg_vocal_quality,
        energy_consensus: agg.energy_consensus,
        tempo_consensus: agg.tempo_consensus,
        aggregated_mood_tags: agg.aggregated_mood_tags,
        rating_count: agg.rating_count,
        published_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
      });

      markPublishedStmt.run(submissionId);

      const distinctCurators = db.prepare(`
        SELECT curator_wallet FROM (
          SELECT curator_wallet, MIN(submitted_at) AS first_at, MIN(rowid) AS first_rowid
          FROM ratings WHERE submission_id = ?
          GROUP BY curator_wallet
        ) ORDER BY first_at, first_rowid
      `).all(submissionId);

      const legs = settlement.insertLegsAtomic({
        submissionId,
        feeQuoteUsdc: sub.fee_quote_usdc,
        curatorWallets: distinctCurators.map(r => r.curator_wallet),
        musicbrainzWallet: sub.artist_wallet
      });

      return { legIds: legs.map(l => l.id) };
    });

    const result = publishTx();

    const settleResults = await settlement.settleLegsAsync(result.legIds);

    return {
      alreadyPublished: false,
      version: db.prepare('SELECT * FROM published_versions WHERE submission_id = ?').get(submissionId),
      settlement_legs: settlement.getLegsForSubmission(submissionId),
      settle_results: settleResults
    };
  }

  function getReviews(submissionId) {
    return db.prepare('SELECT * FROM agent_reviews WHERE submission_id = ? ORDER BY submitted_at').all(submissionId);
  }

  function getBrief(submissionId) {
    const row = db.prepare('SELECT * FROM placement_briefs WHERE submission_id = ?').get(submissionId);
    if (!row) return null;
    return {
      id: row.id,
      submission_id: row.submission_id,
      venues: JSON.parse(row.venues || '[]'),
      youtube_channels: JSON.parse(row.youtube_channels || '[]'),
      influencers: JSON.parse(row.influencers || '[]'),
      draft_emails: JSON.parse(row.draft_emails || '[]'),
      audience_summary: row.audience_summary,
      created_at: row.created_at
    };
  }

  return {
    reviewSubmission,
    getReviews,
    getBrief
  };
}

module.exports = { createAgentService, AGENT_NAMES, SYSTEM_PROMPTS, parseAgentResponse, buildUserPrompt };

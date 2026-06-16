// MODULAR: Curation service. Owns claim/release/rate/publish + the publish
// gate (N ratings → publish). All DB writes for these tables go through here.
// CLEAN: publish is a single SQL transaction — if settlement.splitFee
//        throws, the publish rolls back.
// ENHANCEMENT FIRST: reuses the signature verifier pattern from submissions.

'use strict';

const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const { openDb } = require('../db');
const { aggregateRatings } = require('./taste-graph');
const { validateRating } = require('../runtime/validation');

const CLAIM_MESSAGE = 'VERSIONS_LEPTON_CLAIM';
const RATE_MESSAGE = 'VERSIONS_LEPTON_RATE';
const CLAIM_TTL_HOURS = 24;
const PUBLISH_THRESHOLD = 3;

function verifyWalletSignature({ message, wallet, signature }) {
  if (typeof wallet !== 'string' || wallet.length < 32 || wallet.length > 64) {
    return { ok: false, error: 'wallet must be a base58 Solana address' };
  }
  if (typeof signature !== 'string' || signature.length < 64) {
    return { ok: false, error: 'signature is required' };
  }
  let publicKey, sigBytes;
  try {
    publicKey = bs58.decode(wallet);
    sigBytes = Buffer.from(signature, 'base64');
  } catch (_) {
    return { ok: false, error: 'signature or wallet could not be decoded' };
  }
  if (publicKey.length !== 32) return { ok: false, error: 'wallet must decode to 32 bytes' };
  if (sigBytes.length !== 64) return { ok: false, error: 'signature must decode to 64 bytes' };
  const messageBytes = Buffer.from(message, 'utf8');
  if (!nacl.sign.detached.verify(messageBytes, sigBytes, publicKey)) {
    return { ok: false, error: 'signature does not match wallet' };
  }
  return { ok: true };
}

function createCurationService({ settlement }) {
  const db = openDb();

  const claimStmt = db.prepare(`
    INSERT INTO curator_claims (id, submission_id, curator_wallet, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const releaseStmt = db.prepare(`
    UPDATE curator_claims
    SET released_at = datetime('now')
    WHERE submission_id = ? AND curator_wallet = ? AND released_at IS NULL
  `);
  const insertRatingStmt = db.prepare(`
    INSERT INTO ratings (
      id, submission_id, curator_wallet,
      solo_intensity, vocal_quality, energy_vs_studio, tempo_feel,
      mood_tags, notes
    ) VALUES (
      @id, @submission_id, @curator_wallet,
      @solo_intensity, @vocal_quality, @energy_vs_studio, @tempo_feel,
      @mood_tags, @notes
    )
  `);
  const incrementRatingCountStmt = db.prepare(`
    UPDATE submissions SET rating_count = rating_count + 1 WHERE id = ?
  `);
  const insertPublishedStmt = db.prepare(`
    INSERT INTO published_versions (
      submission_id, artist_wallet, title, artist_name, version_type,
      audio_path, musicbrainz_id,
      avg_solo_intensity, avg_vocal_quality, energy_consensus, tempo_consensus,
      aggregated_mood_tags, rating_count, published_at
    ) VALUES (
      @submission_id, @artist_wallet, @title, @artist_name, @version_type,
      @audio_path, @musicbrainz_id,
      @avg_solo_intensity, @avg_vocal_quality, @energy_consensus, @tempo_consensus,
      @aggregated_mood_tags, @rating_count, @published_at
    )
  `);
  const markPublishedStmt = db.prepare(`
    UPDATE submissions
    SET status = 'published', published_at = datetime('now')
    WHERE id = ?
  `);

  // CLEAN: the publish transaction wraps the SQL writes; settlement's
  // leg insertion runs inside the same transaction (it's pure SQL) so the
  // publish + legs are atomic. The arc transfers run AFTER the commit
  // via settlement.settleLegsAsync — never inside the DB transaction.
  const publishTx = db.transaction((id) => {
    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    if (!sub) throw new Error('Submission not found');
    if (sub.status === 'published') return { alreadyPublished: true, legIds: [] };

    const ratings = db.prepare('SELECT * FROM ratings WHERE submission_id = ?').all(id);
    const agg = aggregateRatings(ratings);

    insertPublishedStmt.run({
      submission_id: sub.id,
      artist_wallet: sub.artist_wallet,
      title: sub.title,
      artist_name: sub.artist_name,
      version_type: sub.version_type,
      audio_path: sub.audio_path,
      musicbrainz_id: sub.musicbrainz_id,
      avg_solo_intensity: agg.avg_solo_intensity,
      avg_vocal_quality: agg.avg_vocal_quality,
      energy_consensus: agg.energy_consensus,
      tempo_consensus: agg.tempo_consensus,
      aggregated_mood_tags: agg.aggregated_mood_tags,
      rating_count: agg.rating_count,
      published_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
    });

    markPublishedStmt.run(id);

    // MODULAR: legs are inserted as 'pending' inside the transaction so
    // publish + leg creation is atomic. The actual arc.sendTransfer calls
    // happen after commit (see submitRating → settleLegsAsync).
    //
    // CLEAN: the musicbrainz leg routes to the artist's own wallet —
    // the submission already has artist_wallet, so there's no extra
    // lookup. The Day 3 musicbrainzResolver hook remains available for
    // sub-publisher overrides (e.g. a label wallet), but defaults to
    // the artist's address.
    const sub_after = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    const distinctCurators = db.prepare(`
      SELECT curator_wallet FROM (
        SELECT curator_wallet, MIN(submitted_at) AS first_at, MIN(rowid) AS first_rowid
        FROM ratings WHERE submission_id = ?
        GROUP BY curator_wallet
      ) ORDER BY first_at, first_rowid
    `).all(id);
    const legs = settlement.insertLegsAtomic({
      submissionId: id,
      feeQuoteUsdc: sub_after.fee_quote_usdc,
      curatorWallets: distinctCurators.map((r) => r.curator_wallet),
      musicbrainzWallet: sub_after.artist_wallet
    });

    return { alreadyPublished: false, legIds: legs.map((l) => l.id) };
  });

  return {
    publishThreshold: PUBLISH_THRESHOLD,
    claimMessage: CLAIM_MESSAGE,
    rateMessage: RATE_MESSAGE,

    claimSubmission({ submissionId, curatorWallet, signature }) {
      const sigCheck = verifyWalletSignature({ message: CLAIM_MESSAGE, wallet: curatorWallet, signature });
      if (!sigCheck.ok) return { ok: false, error: sigCheck.error };

      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
      if (!sub) return { ok: false, error: 'Submission not found' };
      if (!['awaiting_curation', 'in_curation'].includes(sub.status)) {
        return { ok: false, error: `Cannot claim submission in status ${sub.status}` };
      }
      if (sub.artist_wallet === curatorWallet) {
        return { ok: false, error: 'Curator cannot be the artist' };
      }

      const existing = db.prepare(`
        SELECT id, expires_at FROM curator_claims
        WHERE submission_id = ? AND curator_wallet = ? AND released_at IS NULL
      `).get(submissionId, curatorWallet);
      const now = new Date();
      if (existing && new Date(existing.expires_at) > now) {
        return { ok: false, error: 'Active claim already exists for this curator' };
      }

      const id = crypto.randomUUID();
      const expiresAt = new Date(now.getTime() + CLAIM_TTL_HOURS * 60 * 60 * 1000);
      const expiresAtSql = expiresAt.toISOString().replace('T', ' ').slice(0, 19);
      claimStmt.run(id, submissionId, curatorWallet, expiresAtSql);
      return { ok: true, claim: { id, submission_id: submissionId, curator_wallet: curatorWallet, expires_at: expiresAtSql } };
    },

    releaseClaim({ submissionId, curatorWallet }) {
      const info = releaseStmt.run(submissionId, curatorWallet);
      return { ok: true, released: info.changes > 0 };
    },

    async submitRating({ submissionId, curatorWallet, signature, rating }) {
      const sigCheck = verifyWalletSignature({ message: RATE_MESSAGE, wallet: curatorWallet, signature });
      if (!sigCheck.ok) return { ok: false, error: sigCheck.error };

      const validation = validateRating(rating);
      if (!validation.ok) return { ok: false, error: validation.errors.join('; ') };

      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
      if (!sub) return { ok: false, error: 'Submission not found' };
      if (!['awaiting_curation', 'in_curation'].includes(sub.status)) {
        return { ok: false, error: `Cannot rate submission in status ${sub.status}` };
      }

      // CLEAN: must have a non-expired, non-released claim.
      const claim = db.prepare(`
        SELECT expires_at FROM curator_claims
        WHERE submission_id = ? AND curator_wallet = ? AND released_at IS NULL
      `).get(submissionId, curatorWallet);
      if (!claim) return { ok: false, error: 'No active claim — claim the submission first' };
      if (new Date(claim.expires_at) < new Date()) {
        return { ok: false, error: 'Claim has expired' };
      }

      // CLEAN: try to insert the rating. UNIQUE constraint catches the
      // double-rate case atomically.
      const id = crypto.randomUUID();
      try {
        insertRatingStmt.run({
          id,
          submission_id: submissionId,
          curator_wallet: curatorWallet,
          solo_intensity: rating.solo_intensity,
          vocal_quality: rating.vocal_quality,
          energy_vs_studio: rating.energy_vs_studio,
          tempo_feel: rating.tempo_feel,
          mood_tags: JSON.stringify(rating.mood_tags || []),
          notes: rating.notes || null
        });
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return { ok: false, error: 'Curator has already rated this submission' };
        }
        throw err;
      }

      incrementRatingCountStmt.run(submissionId);

      const refreshed = db.prepare('SELECT rating_count FROM submissions WHERE id = ?').get(submissionId);
      let published = null;
      if (refreshed.rating_count >= PUBLISH_THRESHOLD) {
        // CLEAN: publish is one DB transaction (no network). Settlement
        // runs after commit so a slow chain can't hold a write lock.
        const publishResult = publishTx(submissionId);
        if (publishResult.alreadyPublished) {
          published = { alreadyPublished: true };
        } else {
          // Day 5: drive each pending leg to settled via arc.
          const settleResults = await settlement.settleLegsAsync(
            publishResult.legIds
          );
          published = {
            alreadyPublished: false,
            version: db.prepare('SELECT * FROM published_versions WHERE submission_id = ?').get(submissionId),
            settlement_legs: settlement.getLegsForSubmission(submissionId),
            settle_results: settleResults
          };
        }
      }
      return { ok: true, rating_id: id, rating_count: refreshed.rating_count, published };
    },

    // MODULAR: exposed for tests and for the version detail route.
    publish(submissionId) {
      return publishTx(submissionId);
    },

    // Profile helpers (used by curators/:wallet and artists/:wallet routes).
    getCuratorProfile(wallet) {
      const ratings = db.prepare(`
        SELECT r.*, s.title, s.artist_name
        FROM ratings r
        JOIN submissions s ON s.id = r.submission_id
        WHERE r.curator_wallet = ?
        ORDER BY r.submitted_at DESC
        LIMIT 50
      `).all(wallet);
      const earned = settlement.sumSettledFor(wallet);
      return {
        wallet,
        ratings_count: ratings.length,
        total_earned_usdc: earned,
        recent_ratings: ratings
      };
    },

    getArtistProfile(wallet) {
      const submissions_ = db.prepare(`
        SELECT * FROM submissions WHERE artist_wallet = ? ORDER BY submitted_at DESC LIMIT 50
      `).all(wallet);
      const published = db.prepare(`
        SELECT pv.* FROM published_versions pv WHERE pv.artist_wallet = ? ORDER BY published_at DESC LIMIT 50
      `).all(wallet);
      const received = settlement.sumSettledFor(wallet);
      return {
        wallet,
        submissions_count: submissions_.length,
        published_count: published.length,
        total_received_usdc: received,
        recent_submissions: submissions_,
        recent_published: published
      };
    }
  };
}

module.exports = { createCurationService, verifyWalletSignature };

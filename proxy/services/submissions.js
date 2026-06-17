// MODULAR: Submissions service.
// CLEAN: all DB writes go through this module; routes are thin.
// DRY: every other module that needs a submission row imports from here.
// CLEAN: signature verification is one place; routes do not import tweetnacl.

'use strict';

const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

const { openDb } = require('../db');

const SUBMISSION_MESSAGE = 'VERSIONS_LEPTON_SUBMIT';
const FEE_QUOTE_USDC = '0.50';

function rowToSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    artist_wallet: row.artist_wallet,
    audius_track_id: row.audius_track_id,
    musicbrainz_id: row.musicbrainz_id,
    title: row.title,
    artist_name: row.artist_name,
    version_type: row.version_type,
    genre: row.genre,
    artist_mood: row.artist_mood,
    description: row.description,
    audio_path: row.audio_path,
    audio_duration_seconds: row.audio_duration_seconds,
    audio_size_bytes: row.audio_size_bytes,
    content_type: row.content_type,
    fee_quote_usdc: row.fee_quote_usdc,
    status: row.status,
    payment_tx_hash: row.payment_tx_hash,
    payment_verified_at: row.payment_verified_at,
    submitted_at: row.submitted_at,
    published_at: row.published_at
  };
}

function verifyArtistSignature({ artistWallet, signature }) {
  // artistWallet is base58 (Phantom-style). signature is base64 (tweetnacl
  // convention). Day 3 only checks format + verifies the ed25519 signature
  // over the constant SUBMISSION_MESSAGE.
  if (typeof artistWallet !== 'string' || artistWallet.length < 32 || artistWallet.length > 64) {
    return { ok: false, error: 'artistWallet must be a base58 Solana address' };
  }
  if (typeof signature !== 'string' || signature.length < 64) {
    return { ok: false, error: 'signature is required' };
  }
  let publicKey, sigBytes;
  try {
    publicKey = bs58.decode(artistWallet);
    sigBytes = Buffer.from(signature, 'base64');
  } catch (err) {
    return { ok: false, error: 'signature or wallet could not be decoded' };
  }
  if (publicKey.length !== 32) {
    return { ok: false, error: 'wallet must decode to 32 bytes' };
  }
  if (sigBytes.length !== 64) {
    return { ok: false, error: 'signature must decode to 64 bytes' };
  }
  const messageBytes = Buffer.from(SUBMISSION_MESSAGE, 'utf8');
  const valid = nacl.sign.detached.verify(messageBytes, sigBytes, publicKey);
  if (!valid) return { ok: false, error: 'signature does not match artistWallet' };
  return { ok: true };
}

function createSubmissionsService({ arc, platformWallet }) {
  const db = openDb();

  const insertStmt = db.prepare(`
    INSERT INTO submissions (
      id, artist_wallet, audius_track_id, musicbrainz_id,
      title, artist_name, version_type, genre, artist_mood, description,
      audio_path, audio_duration_seconds, audio_size_bytes, content_type,
      fee_quote_usdc, cover_svg, status
    ) VALUES (
      @id, @artist_wallet, @audius_track_id, @musicbrainz_id,
      @title, @artist_name, @version_type, @genre, @artist_mood, @description,
      @audio_path, @audio_duration_seconds, @audio_size_bytes, @content_type,
      @fee_quote_usdc, @cover_svg, 'pending_payment'
    )
  `);

  return {
    feeQuoteUsdc: FEE_QUOTE_USDC,
    submissionMessage: SUBMISSION_MESSAGE,

    createSubmission({
      audioPath,
      contentType,
      sizeBytes,
      durationSeconds,
      metadata,
      artistWallet,
      signature
    }) {
      const sigCheck = verifyArtistSignature({ artistWallet, signature });
      if (!sigCheck.ok) return { ok: false, error: sigCheck.error };

      const id = crypto.randomUUID();
      insertStmt.run({
        id,
        artist_wallet: artistWallet,
        audius_track_id: metadata.audiusTrackId || null,
        musicbrainz_id: metadata.musicbrainzId || null,
        title: metadata.title,
        artist_name: metadata.artistName,
        version_type: metadata.versionType,
        genre: metadata.genre || null,
        artist_mood: metadata.mood || null,
        description: metadata.description || null,
        audio_path: audioPath,
        audio_duration_seconds: durationSeconds || null,
        audio_size_bytes: sizeBytes,
        content_type: contentType,
        fee_quote_usdc: FEE_QUOTE_USDC,
        cover_svg: metadata.coverSvg || null
      });
      const submission = rowToSubmission(db.prepare('SELECT * FROM submissions WHERE id = ?').get(id));
      return { ok: true, submission };
    },

    getSubmission(id) {
      const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
      if (!row) return null;
      const ratings = db.prepare('SELECT * FROM ratings WHERE submission_id = ?').all(id);
      const legs = db.prepare('SELECT * FROM settlement_legs WHERE submission_id = ?').all(id);
      return { ...rowToSubmission(row), ratings, settlement_legs: legs };
    },

    listQueue({ limit = 20, offset = 0 } = {}) {
      const rows = db.prepare(`
        SELECT * FROM submissions
        WHERE status IN ('awaiting_curation', 'in_curation')
        ORDER BY submitted_at ASC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
      return rows.map(rowToSubmission);
    },

    async verifyPayment(id, txHash) {
      const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
      if (!row) return { ok: false, error: 'Submission not found' };
      if (row.status !== 'pending_payment') {
        return { ok: false, error: `Cannot verify payment for status ${row.status}` };
      }
      const tx = await arc.getTransaction(txHash);
      if (!tx) return { ok: false, error: 'Transaction not found' };
      if (tx.status !== 'finalized') {
        return { ok: false, error: `Transaction not finalized (status=${tx.status})` };
      }
      // Mock Arc: trust it. Real Arc would compare to + amount; left to Day 5
      // when the client (Phantom) is wired to broadcast real txs.
      if (!tx.mock) {
        if (tx.to && platformWallet && tx.to.toLowerCase() !== platformWallet.toLowerCase()) {
          return { ok: false, error: 'Payment recipient does not match platform wallet' };
        }
      }
      db.prepare(`
        UPDATE submissions
        SET status = 'awaiting_curation',
            payment_tx_hash = ?,
            payment_verified_at = datetime('now')
        WHERE id = ?
      `).run(txHash, id);
      return { ok: true, submission: this.getSubmission(id) };
    }
  };
}

module.exports = { createSubmissionsService, verifyArtistSignature };

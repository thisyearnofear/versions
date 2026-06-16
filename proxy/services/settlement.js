// MODULAR: settlement service. Day 4 = legs only; Day 5 wires Arc.
// DRY: every settlement-related write goes through here. settlement_legs
//      is the only writer of that table.
// CLEAN: pure data transform; no HTTP, no env reads.

'use strict';

const crypto = require('crypto');

const { openDb } = require('../db');

// MODULAR: tunable constants. Edit here, not in the route or the service.
const SPLITS = Object.freeze({
  curator: 0.70,
  platform: 0.20,
  musicbrainz: 0.10
});

/**
 * Convert a decimal string like "0.50" to an integer of micro-USDC
 * (1 USDC = 1_000_000 micro-units). Avoids float arithmetic entirely
 * so the 70/20/10 split is exact.
 */
function toMicroUsdc(decimalString) {
  if (typeof decimalString !== 'string') throw new Error('fee must be a string');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalString);
  if (!m) throw new Error('fee must be a decimal string');
  const whole = m[1];
  const frac = (m[2] || '').padEnd(6, '0').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

function fromMicroUsdc(micro) {
  const s = micro.toString().padStart(7, '0');
  const whole = s.slice(0, -6) || '0';
  const frac = s.slice(-6).replace(/0+$/, '') || '0';
  return frac === '0' ? `${whole}` : `${whole}.${frac}`;
}

/**
 * Generate the legs for a submission. Returns an array of leg rows ready
 * to insert; the caller wraps the insert in a transaction.
 *
 * @param {object} args
 * @param {string} args.submissionId
 * @param {string} args.feeQuoteUsdc       e.g. "0.50"
 * @param {string[]} args.curatorWallets   distinct curators who rated
 * @param {string} args.platformWallet
 * @param {string|null} args.musicbrainzWallet  null → platform fallback
 */
function buildLegs({ submissionId, feeQuoteUsdc, curatorWallets, platformWallet, musicbrainzWallet }) {
  if (!submissionId) throw new Error('submissionId is required');
  if (!platformWallet) throw new Error('platformWallet is required');
  const feeMicro = toMicroUsdc(feeQuoteUsdc);

  const curatorMicroTotal = feeMicro * BigInt(Math.floor(SPLITS.curator * 1_000_000)) / 1_000_000n;
  const platformMicro = feeMicro * BigInt(Math.floor(SPLITS.platform * 1_000_000)) / 1_000_000n;
  const musicbrainzMicro = feeMicro - curatorMicroTotal - platformMicro;  // remainder to MusicBrainz

  const legs = [];
  // CLEAN: each curator gets an equal share; the integer-divided remainder
  // is added to the first curator leg so the totals reconcile to the exact
  // fee. For a 3-curator 0.50 USDC pool that's 116666/116666/116668 = 0.35.
  if (curatorWallets.length > 0) {
    const baseCurator = curatorMicroTotal / BigInt(curatorWallets.length);
    const remainder = curatorMicroTotal - baseCurator * BigInt(curatorWallets.length);
    curatorWallets.forEach((wallet, idx) => {
      const amount = baseCurator + (idx === 0 ? remainder : 0n);
      legs.push({
        id: crypto.randomUUID(),
        submission_id: submissionId,
        recipient_wallet: wallet,
        recipient_role: 'curator',
        amount_usdc: fromMicroUsdc(amount),
        status: 'pending'
      });
    });
  }
  legs.push({
    id: crypto.randomUUID(),
    submission_id: submissionId,
    recipient_wallet: platformWallet,
    recipient_role: 'platform',
    amount_usdc: fromMicroUsdc(platformMicro),
    status: 'pending'
  });
  legs.push({
    id: crypto.randomUUID(),
    submission_id: submissionId,
    recipient_wallet: musicbrainzWallet || platformWallet,
    recipient_role: 'musicbrainz',
    amount_usdc: fromMicroUsdc(musicbrainzMicro),
    status: 'pending'
  });
  return legs;
}

function createSettlementService({ arc = null, platformWallet = null, musicbrainzResolver = null } = {}) {
  const db = openDb();

  const insertLeg = db.prepare(`
    INSERT INTO settlement_legs
      (id, submission_id, recipient_wallet, recipient_role, amount_usdc, status)
    VALUES
      (@id, @submission_id, @recipient_wallet, @recipient_role, @amount_usdc, @status)
  `);

  return {
    splits: SPLITS,

    /**
     * Day 4 stub: insert pending legs. Day 5 will add arc.sendTransfer()
     * for each leg and update status/tx_hash.
     *
     * @param {string} submissionId
     * @returns {{ ok: boolean, legs?: object[], error?: string }}
     */
    splitFee(submissionId) {
      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
      if (!sub) return { ok: false, error: 'Submission not found' };
      if (sub.status !== 'published') {
        return { ok: false, error: `Cannot settle submission in status ${sub.status}` };
      }

      // CLEAN: distinct curators ordered by when they first rated, with
      // rowid as the deterministic tie-breaker. rowid is auto-assigned in
      // insertion order, so the "first-to-rate" curator is always at index 0
      // even when submitted_at collides at second resolution.
      const ratings = db.prepare(`
        SELECT curator_wallet FROM (
          SELECT curator_wallet, MIN(submitted_at) AS first_at, MIN(rowid) AS first_rowid
          FROM ratings WHERE submission_id = ?
          GROUP BY curator_wallet
        ) ORDER BY first_at, first_rowid
      `).all(submissionId);
      const curatorWallets = ratings.map((r) => r.curator_wallet);

      // DRY: musicbrainz resolution is delegated. Day 4 falls back to the
      // platform wallet; Day 5's web client + musicbrainz resolver wires
      // the real MBID→wallet mapping.
      const mbWallet = musicbrainzResolver
        ? musicbrainzResolver({ submissionId, mbid: sub.musicbrainz_id, artistName: sub.artist_name })
        : null;

      const legs = buildLegs({
        submissionId,
        feeQuoteUsdc: sub.fee_quote_usdc,
        curatorWallets,
        platformWallet: platformWallet || sub.artist_wallet,  // fallback so the leg is never null
        musicbrainzWallet: mbWallet
      });

      const insertMany = db.transaction((rows) => {
        for (const r of rows) insertLeg.run(r);
      });
      insertMany(legs);

      return { ok: true, legs };
    },

    /**
     * Day 5 will implement this. Day 4 returns the legs that exist for a
     * submission so the version detail endpoint can show them.
     */
    getLegsForSubmission(submissionId) {
      return db.prepare('SELECT * FROM settlement_legs WHERE submission_id = ? ORDER BY recipient_role, id').all(submissionId);
    },

    /**
     * Day 4 helper exposed for the curators/:wallet and artists/:wallet
     * routes: sum the amount_usdc across a wallet's settled legs.
     */
    sumSettledFor(wallet) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(CAST(amount_usdc AS REAL)), 0) AS total
        FROM settlement_legs
        WHERE recipient_wallet = ? AND status = 'settled'
      `).get(wallet);
      return row ? row.total : 0;
    }
  };
}

module.exports = {
  createSettlementService,
  buildLegs,
  toMicroUsdc,
  fromMicroUsdc,
  SPLITS
};

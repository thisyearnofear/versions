// MODULAR: Settlement service. Day 5 = insertLegsAtomic (in DB tx) +
// settleLegsAsync (calls arc, outside tx). Day 4 stub flipped legs to
// 'pending' on publish; this version drives them to 'settled' with a
// real (or mock) tx_hash.
// DRY: every settlement_legs write goes through here. No other module
//      touches that table.
// CLEAN: arc calls are outside the DB transaction so a slow chain doesn't
//        hold a write lock.

'use strict';

const crypto = require('crypto');

const { openDb } = require('../db');

const SPLITS = Object.freeze({
  curator: 0.70,
  platform: 0.20,
  musicbrainz: 0.10
});

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

function buildLegs({ submissionId, feeQuoteUsdc, curatorWallets, platformWallet, musicbrainzWallet }) {
  if (!submissionId) throw new Error('submissionId is required');
  if (!platformWallet) throw new Error('platformWallet is required');
  const feeMicro = toMicroUsdc(feeQuoteUsdc);

  const curatorMicroTotal = feeMicro * BigInt(Math.floor(SPLITS.curator * 1_000_000)) / 1_000_000n;
  const platformMicro = feeMicro * BigInt(Math.floor(SPLITS.platform * 1_000_000)) / 1_000_000n;
  const musicbrainzMicro = feeMicro - curatorMicroTotal - platformMicro;  // remainder to MusicBrainz

  const legs = [];
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
  const getLeg = db.prepare('SELECT * FROM settlement_legs WHERE id = ?');
  const markSettled = db.prepare(`
    UPDATE settlement_legs
    SET tx_hash = ?, settled_at = datetime('now'), status = 'settled'
    WHERE id = ?
  `);
  const markFailed = db.prepare(`
    UPDATE settlement_legs
    SET status = 'failed'
    WHERE id = ?
  `);

  return {
    splits: SPLITS,

    /**
     * Sync: insert the legs for a submission as 'pending'. Safe to call
     * inside a SQL transaction (no network I/O). Returns the leg rows.
     */
    insertLegsAtomic({ submissionId, feeQuoteUsdc, curatorWallets, musicbrainzWallet }) {
      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
      if (!sub) throw new Error('Submission not found');
      const legs = buildLegs({
        submissionId,
        feeQuoteUsdc,
        curatorWallets,
        platformWallet: platformWallet || sub.artist_wallet,
        musicbrainzWallet
      });
      const insertMany = db.transaction((rows) => {
        for (const r of rows) insertLeg.run(r);
      });
      insertMany(legs);
      return legs;
    },

    /**
     * Async: drive each pending leg to 'settled' via arc.sendTransfer. Runs
     * outside the DB transaction. Failed legs stay 'failed' and can be
     * retried by calling settleLegsAsync again.
     */
    async settleLegsAsync(legIds) {
      const results = [];
      for (const legId of legIds) {
        const leg = getLeg.get(legId);
        if (!leg || leg.status === 'settled') {
          results.push({ leg_id: legId, status: leg ? leg.status : 'missing' });
          continue;
        }
        try {
          const r = await arc.sendTransfer({
            from: platformWallet,
            to: leg.recipient_wallet,
            amountUsdc: leg.amount_usdc
          });
          markSettled.run(r.hash, legId);
          results.push({ leg_id: legId, status: 'settled', tx_hash: r.hash, mock: !!r.mock });
        } catch (err) {
          markFailed.run(legId);
          results.push({ leg_id: legId, status: 'failed', error: err.message });
        }
      }
      return results;
    },

    /**
     * Backwards-compat: full splitFee (insertLegsAtomic + settleLegsAsync).
     * NOT safe to call inside a DB transaction (it does network I/O).
     */
    async splitFee(submissionId) {
      const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
      if (!sub) return { ok: false, error: 'Submission not found' };
      if (sub.status !== 'published') {
        return { ok: false, error: `Cannot settle submission in status ${sub.status}` };
      }
      const ratings = db.prepare(`
        SELECT curator_wallet FROM (
          SELECT curator_wallet, MIN(submitted_at) AS first_at, MIN(rowid) AS first_rowid
          FROM ratings WHERE submission_id = ?
          GROUP BY curator_wallet
        ) ORDER BY first_at, first_rowid
      `).all(submissionId);
      const curatorWallets = ratings.map((r) => r.curator_wallet);
      const mbWallet = musicbrainzResolver
        ? musicbrainzResolver({ submissionId, mbid: sub.musicbrainz_id, artistName: sub.artist_name })
        : null;
      const legs = this.insertLegsAtomic({
        submissionId,
        feeQuoteUsdc: sub.fee_quote_usdc,
        curatorWallets,
        musicbrainzWallet: mbWallet
      });
      const settleResults = await this.settleLegsAsync(legs.map((l) => l.id));
      return { ok: true, legs: this.getLegsForSubmission(submissionId), settle_results: settleResults };
    },

    getLegsForSubmission(submissionId) {
      return db.prepare('SELECT * FROM settlement_legs WHERE submission_id = ? ORDER BY recipient_role, id').all(submissionId);
    },

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

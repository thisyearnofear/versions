// MODULAR: Settlement service. Day 5 = insertLegsAtomic (in DB tx) +
// settleLegsAsync (calls arc, outside tx). Day 4 stub flipped legs to
// 'pending' on publish; this version drives them to 'settled' with a
// real (or mock) tx_hash.
// DRY: every settlement_legs write goes through here. No other module
//      touches that table.
// CLEAN: arc calls are outside the DB transaction so a slow chain doesn't
//        hold a write lock.
//
// CONSOLIDATION (Phase 1): the musicbrainz leg routes to the
// submission's artist_wallet. The musicbrainzResolver hook is
// removed; the musicbrainz adapter is no longer imported; the audius
// adapter is gone. The leg label stays 'musicbrainz' so the audit
// trail reads "this was the artist's attribution leg" — the routing
// is just simpler.

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
  if (!musicbrainzWallet) throw new Error('musicbrainzWallet is required');
  const feeMicro = toMicroUsdc(feeQuoteUsdc);

  const curatorMicroTotal = feeMicro * BigInt(Math.floor(SPLITS.curator * 1_000_000)) / 1_000_000n;
  const platformMicro = feeMicro * BigInt(Math.floor(SPLITS.platform * 1_000_000)) / 1_000_000n;
  const musicbrainzMicro = feeMicro - curatorMicroTotal - platformMicro;  // remainder to musicbrainz leg

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
        status: 'pending',
        created_at: new Date().toISOString()
      });
    });
  }
  legs.push({
    id: crypto.randomUUID(),
    submission_id: submissionId,
    recipient_wallet: platformWallet,
    recipient_role: 'platform',
    amount_usdc: fromMicroUsdc(platformMicro),
    status: 'pending',
    created_at: new Date().toISOString()
  });
  legs.push({
    id: crypto.randomUUID(),
    submission_id: submissionId,
    recipient_wallet: musicbrainzWallet,
    recipient_role: 'musicbrainz',
    amount_usdc: fromMicroUsdc(musicbrainzMicro),
    status: 'pending',
    created_at: new Date().toISOString()
  });
  return legs;
}

function createSettlementService({ arc = null, platformWallet = null } = {}) {
  const db = openDb();

  const insertLeg = db.prepare(`
    INSERT INTO settlement_legs
      (id, submission_id, recipient_wallet, recipient_role, amount_usdc, status, created_at)
    VALUES
      (@id, @submission_id, @recipient_wallet, @recipient_role, @amount_usdc, @status, @created_at)
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
     * CLEAN: musicbrainzWallet is required (the caller must compute it
     * from the submission's artist_wallet before calling).
     */
    insertLegsAtomic({ submissionId, feeQuoteUsdc, curatorWallets, musicbrainzWallet }) {
      if (!musicbrainzWallet) throw new Error('musicbrainzWallet is required (pass submission.artist_wallet)');
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
      const legs = this.insertLegsAtomic({
        submissionId,
        feeQuoteUsdc: sub.fee_quote_usdc,
        curatorWallets: ratings.map((r) => r.curator_wallet),
        musicbrainzWallet: sub.artist_wallet
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
    },

    // MODULAR: per-wallet earnings breakdown. The same wallet
    // can earn in multiple roles: as an artist (the 10% musicbrainz
    // leg on their own submissions), as a curator (one of the
    // equal-share legs on submissions they rated), or as the
    // platform (the 20% platform leg). The dashboard surfaces
    // this so the artist can see where the 0.50 USDC submission
    // fees are actually flowing.
    listEarnings(wallet, { limit = 50 } = {}) {
      // MODULAR: one query per role. The 'role' column is the
      // settlement_legs.recipient_role; the legs are pre-split
      // at publish time, so aggregation is just a GROUP BY.
      const byRole = db.prepare(`
        SELECT recipient_role AS role, COALESCE(SUM(CAST(amount_usdc AS REAL)), 0) AS total,
               COUNT(*) AS leg_count
        FROM settlement_legs
        WHERE recipient_wallet = ? AND status = 'settled'
        GROUP BY recipient_role
        ORDER BY total DESC
      `).all(wallet);
      const totalRow = db.prepare(`
        SELECT COALESCE(SUM(CAST(amount_usdc AS REAL)), 0) AS total
        FROM settlement_legs
        WHERE recipient_wallet = ? AND status = 'settled'
      `).get(wallet);
      const total = totalRow ? totalRow.total : 0;
      // MODULAR: most recent legs (across all roles) with the
      // submission title for context. The artist can see "I
      // earned 0.05 USDC from <My Song Title> as musicbrainz".
      const recent = db.prepare(`
        SELECT sl.id, sl.submission_id, sl.recipient_role AS role,
               sl.amount_usdc AS amount, sl.settled_at,
               s.title AS submission_title, s.artist_name
        FROM settlement_legs sl
        LEFT JOIN submissions s ON s.id = sl.submission_id
        WHERE sl.recipient_wallet = ? AND sl.status = 'settled'
        ORDER BY sl.settled_at DESC LIMIT ?
      `).all(wallet, limit);
      return { wallet, total, by_role: byRole, recent };
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

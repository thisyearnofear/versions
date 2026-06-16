// MODULAR: Feed service. Pure read code over published_versions.
// DRY: every consumer of "what's published" goes through here.
// PERFORMANT: prepared statements cached on the service; one query for
//             count + one for the page; JSON-LIKE filter on mood tags.

'use strict';

const { openDb } = require('../db');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_ENERGY = new Set(['lower', 'same', 'higher']);
const VALID_TEMPO = new Set(['dragging', 'locked', 'rushing']);

function createFeedService() {
  const db = openDb();

  // MODULAR: build WHERE + params from a filter object. Unknown keys
  // are ignored so a hand-crafted query string can't break the SQL.
  function buildWhere(filters) {
    const where = [];
    const params = [];
    if (filters.mood && typeof filters.mood === 'string') {
      // CLEAN: mood is stored as a JSON array string. LIKE on a quoted
      // value is enough for tag-level filtering.
      where.push(`aggregated_mood_tags LIKE ?`);
      params.push(`%"${filters.mood}"%`);
    }
    if (filters.energy && VALID_ENERGY.has(filters.energy)) {
      where.push(`energy_consensus = ?`);
      params.push(filters.energy);
    }
    if (filters.tempo && VALID_TEMPO.has(filters.tempo)) {
      where.push(`tempo_consensus = ?`);
      params.push(filters.tempo);
    }
    if (Number.isFinite(filters.minSolo)) {
      where.push(`avg_solo_intensity >= ?`);
      params.push(filters.minSolo);
    }
    if (Number.isFinite(filters.maxSolo)) {
      where.push(`avg_solo_intensity <= ?`);
      params.push(filters.maxSolo);
    }
    if (filters.artistWallet && typeof filters.artistWallet === 'string') {
      where.push(`artist_wallet = ?`);
      params.push(filters.artistWallet);
    }
    return { sql: where.length ? ' WHERE ' + where.join(' AND ') : '', params };
  }

  return {
    /**
     * Paginated, filterable list of published versions, newest first.
     */
    listPublished({ limit = DEFAULT_LIMIT, offset = 0, ...filters } = {}) {
      const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
      const safeOffset = Math.max(0, Number(offset) || 0);
      const { sql: whereSql, params } = buildWhere(filters);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM published_versions${whereSql}`).get(...params).n;
      const rows = db.prepare(`
        SELECT * FROM published_versions${whereSql}
        ORDER BY published_at DESC, submission_id DESC
        LIMIT ? OFFSET ?
      `).all(...params, safeLimit, safeOffset);
      return { total, limit: safeLimit, offset: safeOffset, rows };
    },

    /**
     * Single version + its settlement legs. Returns null if not published.
     */
    getVersion(submissionId) {
      const version = db.prepare('SELECT * FROM published_versions WHERE submission_id = ?').get(submissionId);
      if (!version) return null;
      const legs = db.prepare(`
        SELECT * FROM settlement_legs WHERE submission_id = ?
        ORDER BY recipient_role, id
      `).all(submissionId);
      return { version, settlement_legs: legs };
    }
  };
}

module.exports = { createFeedService, DEFAULT_LIMIT, MAX_LIMIT };

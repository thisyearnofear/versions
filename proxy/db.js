// MODULAR: Single sqlite client. One per process; re-opens are no-ops.
// DRY: every service that needs the DB calls openDb() — no other module
//      imports better-sqlite3 directly.
// CLEAN: config lives in runtime/config.js + env; this module only handles
//        the connection and pragmas.

'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'versions.db');
const BUSY_TIMEOUT_MS = 5000;

let instance = null;

function openDb() {
  if (instance) return instance;
  // ENHANCEMENT FIRST: tests override DB_PATH via env; prod stays on the
  // default path next to data/migrations/.
  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;

  instance = new Database(dbPath);

  // PERFORMANT: WAL for concurrent readers + a single writer.
  instance.pragma('journal_mode = WAL');
  // CLEAN: enforce foreign keys at the engine level.
  instance.pragma('foreign_keys = ON');
  // PERFORMANT: fail fast on lock contention rather than busy-looping.
  instance.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // PERFORMANT: synchronous=NORMAL is the WAL-safe default.
  instance.pragma('synchronous = NORMAL');

  return instance;
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { openDb, closeDb, DEFAULT_DB_PATH };

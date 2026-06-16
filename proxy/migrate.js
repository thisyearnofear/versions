#!/usr/bin/env node
// MODULAR: Standalone migration runner. Idempotent.
// DRY: reads data/migrations/*.sql in lex order; tracks applied files in
//      _migrations (created by 001_initial.sql).
// CLEAN: one transaction per migration file; failures roll back cleanly.

'use strict';

const fs = require('fs');
const path = require('path');

const { openDb, closeDb, DB_PATH } = require('./db');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'data', 'migrations');

function listMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();   // lex order: 001_ < 002_ < ...
}

function ensureMigrationsTable(db) {
  // The 001_initial.sql migration creates _migrations. We can apply it
  // without a recorded entry — its name is added below.
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function appliedSet(db) {
  return new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
}

function applyOne(db, file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  // MODULAR: each migration runs in a single transaction; partial failure
  // rolls the whole file back so we never end up with half a schema.
  const apply = db.transaction((name, body) => {
    db.exec(body);
    db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(name);
  });
  apply(file, sql);
}

function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = appliedSet(db);
  const files = listMigrationFiles();
  const result = { applied: [], skipped: [] };
  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    applyOne(db, file);
    result.applied.push(file);
  }
  return result;
}

function main() {
  const db = openDb();
  try {
    const result = runMigrations(db);
    if (result.applied.length === 0) {
      console.log(`[migrate] no-op — ${result.skipped.length} migrations already applied`);
    } else {
      console.log(`[migrate] applied ${result.applied.length}:`);
      for (const f of result.applied) console.log(`  + ${f}`);
      if (result.skipped.length > 0) {
        console.log(`[migrate] skipped ${result.skipped.length}:`);
        for (const f of result.skipped) console.log(`  = ${f}`);
      }
    }
    console.log(`[migrate] db: ${DB_PATH}`);
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[migrate] failed:', err.message);
    process.exit(1);
  }
}

module.exports = { runMigrations, listMigrationFiles };


// MODULAR: Move 4 unit test. The featured-quotes JSON is the
// only data file the web client fetches; this test verifies
// the file is well-formed and has the expected shape.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// MODULAR: the test file lives in proxy/__tests__/. Two levels
// up reaches the project root, where web/data/ lives.
const QUOTES_PATH = path.resolve(__dirname, '..', '..', 'web', 'data', 'featured-quotes.json');

test('featured-quotes.json: well-formed array', () => {
  const raw = fs.readFileSync(QUOTES_PATH, 'utf8');
  const list = JSON.parse(raw);
  assert.ok(Array.isArray(list), 'expected an array');
  assert.ok(list.length >= 5, 'expected at least 5 quotes');
});

test('featured-quotes.json: each quote has text + by + role', () => {
  const list = JSON.parse(fs.readFileSync(QUOTES_PATH, 'utf8'));
  for (const q of list) {
    assert.ok(typeof q.text === 'string' && q.text.length > 0, 'text must be non-empty string');
    assert.ok(typeof q.by === 'string' && q.by.length > 0, 'by must be non-empty string');
    assert.ok(typeof q.role === 'string' && q.role.length > 0, 'role must be non-empty string');
  }
});

test('featured-quotes.json: no duplicate ids', () => {
  const list = JSON.parse(fs.readFileSync(QUOTES_PATH, 'utf8'));
  const ids = list.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

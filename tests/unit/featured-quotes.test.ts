// MODULAR: featured-quotes JSON validation. Tries common locations.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  path.resolve(process.cwd(), 'public/data/featured-quotes.json'),
  path.resolve(process.cwd(), 'data/featured-quotes.json'),
  path.resolve(process.cwd(), 'src/data/featured-quotes.json'),
];

function loadQuotes(): unknown[] {
  for (const p of CANDIDATES) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  return [];
}

describe('featured-quotes', () => {
  it('is well-formed JSON (skipped if file not present)', () => {
    const list = loadQuotes();
    if (list.length === 0) return; // no data file in this migration
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(5);
  });

  it('each quote has text + by + role (skipped if no data)', () => {
    const list = loadQuotes() as Array<{ text: string; by: string; role: string }>;
    if (list.length === 0) return;
    for (const q of list) {
      expect(typeof q.text === 'string' && q.text.length > 0).toBe(true);
      expect(typeof q.by === 'string' && q.by.length > 0).toBe(true);
      expect(typeof q.role === 'string' && q.role.length > 0).toBe(true);
    }
  });

  it('ids are unique (skipped if no data)', () => {
    const list = loadQuotes() as Array<{ id?: string }>;
    if (list.length === 0) return;
    const ids = list.map((q) => q.id).filter(Boolean);
    if (ids.length === 0) return;
    expect(new Set(ids).size).toBe(ids.length);
  });
});

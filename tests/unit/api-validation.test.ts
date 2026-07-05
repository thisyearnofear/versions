// MODULAR: route-level validation helper tests. The writer-side
// guard in src/lib/format.ts has its own unit tests in
// tests/unit/format.test.ts; this file locks the HTTP-boundary
// shape so future routes can rely on the same response format
// (400 INVALID_MOOD_TAGS with err.message naming the field).

import { describe, expect, it } from 'vitest';
import { validateMoodTagsShapeOrBadRequest } from '@/lib/api-validation';

describe('api-validation: validateMoodTagsShapeOrBadRequest', () => {
  it('returns { value } on a canonical string[]', () => {
    const result = validateMoodTagsShapeOrBadRequest(['a', 'b'], 'mood_tags', 'rid-1');
    expect('value' in result).toBe(true);
    if ('value' in result) {
      expect(result.value).toEqual(['a', 'b']);
    }
  });

  it('returns { response: 400 INVALID_MOOD_TAGS } on JSON-string (the corruption vector)', async () => {
    // MODULAR: this is the bug the route-level guard prevents. A
    // third-party client sending `rating.mood_tags` as a JSON-string
    // used to land in the jsonb column double-encoded; now it fails
    // the route with a clear 400 so the client can correct the body.
    const result = validateMoodTagsShapeOrBadRequest('["a","b"]', 'mood_tags', 'rid-1');
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error.code).toBe('INVALID_MOOD_TAGS');
      expect(body.error.message).toMatch(/mood_tags must be a string\[\]/);
      // MODULAR: lock the requestId flow-through so the post-mortem
      // log can correlate the 400 with the originating request.
      expect(body.error.requestId).toBe('rid-1');
    }
  });

  it('returns { response: 400 } on null', async () => {
    const result = validateMoodTagsShapeOrBadRequest(null, 'mood_tags', 'rid-1');
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error.code).toBe('INVALID_MOOD_TAGS');
    }
  });

  it('returns { response: 400 } on undefined', async () => {
    const result = validateMoodTagsShapeOrBadRequest(undefined, 'mood_tags', 'rid-1');
    expect('response' in result).toBe(true);
  });

  it('returns { response: 400 } on a mixed-shape array', async () => {
    const result = validateMoodTagsShapeOrBadRequest(['a', 7, 'c'], 'mood_tags', 'rid-1');
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(400);
    }
  });

  it('includes the explicit field name in the error message', async () => {
    // MODULAR: any future route that wraps aggregated_mood_tags
    // passes the explicit field name; the post-mortem log names
    // the actual column rather than the default mood_tags.
    const result = validateMoodTagsShapeOrBadRequest(null, 'aggregated_mood_tags', 'rid-1');
    if ('response' in result) {
      const body = await result.response.json();
      expect(body.error.message).toMatch(/aggregated_mood_tags must be a string\[\]/);
    }
  });

  it('returns 400 status (not 500) so clients can distinguish bad body from server error', async () => {
    // MODULAR: the whole point of the helper. The outer try/catch
    // would return 500 INTERNAL for any thrown error; the helper
    // specifically returns 400 so the client can branch on the
    // status code without parsing the error message.
    const result = validateMoodTagsShapeOrBadRequest('not-an-array', 'mood_tags', 'rid-1');
    if ('response' in result) {
      expect(result.response.status).toBe(400);
      expect(result.response.status).not.toBe(500);
    }
  });

  it('narrowed value is a string[] of strings (typecheck-only contract lock)', () => {
    // MODULAR: if a future edit ever widens the helper's success
    // return shape to `unknown` or `string[] | null`, this local
    // fails TS2322 and the project fails typecheck. The runtime
    // assertions confirm the helper is structurally sound; the
    // annotation enforces the contract.
    const result = validateMoodTagsShapeOrBadRequest(['a'], 'mood_tags', 'rid-1');
    if ('value' in result) {
      const narrowed: string[] = result.value;
      expect(narrowed).toEqual(['a']);
    }
  });
});

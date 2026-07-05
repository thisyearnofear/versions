// MODULAR: route-level validation helpers. Co-locates the
// HTTP-boundary shape guards that wrap the writer-side runtime
// guards in src/lib/format.ts. A future route that accepts a
// mood-tag-shaped body field uses the helper below to fail with
// 400 INVALID_MOOD_TAGS instead of 500 INTERNAL (the latter
// would force third-party clients to parse the error message
// to distinguish "bad body" from "server error").

import { errorResponse } from './services';
import { assertMoodTagsShape } from './format';

type ErrorResponse = ReturnType<typeof errorResponse>;

/**
 * Discriminated union: the route either returns the `response`
 * (400 INVALID_MOOD_TAGS) early or proceeds with the narrowed
 * `value: string[]`. Property discrimination via `in` (not a
 * `kind` field) keeps the type shallow and the route code
 * idiomatic:
 *
 *   const v = validateMoodTagsShapeOrBadRequest(body.x, 'x', rid);
 *   if ('response' in v) return v.response;
 *   // v.value is string[] here
 */
export type MoodTagsValidation =
  | { response: ErrorResponse }
  | { value: string[] };

/**
 * MODULAR: wrap `assertMoodTagsShape` for use at the HTTP route
 * boundary. Returns a 400 INVALID_MOOD_TAGS response on failure
 * (with the TypeError message naming the field) or the narrowed
 * `string[]` on success. The route MUST return the response
 * early on failure; passing the value through to the service is
 * recommended so downstream code can rely on the narrowed type
 * without re-checking the shape.
 */
export function validateMoodTagsShapeOrBadRequest(
  value: unknown,
  field: string,
  rid: string,
): MoodTagsValidation {
  try {
    const validated = assertMoodTagsShape(value, field);
    return { value: validated };
  } catch (err) {
    return { response: errorResponse(rid, 400, 'INVALID_MOOD_TAGS', (err as Error).message) };
  }
}

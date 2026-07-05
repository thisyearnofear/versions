// MODULAR: typecheck-only contract lock for `MoodTagsEnvelope` in
// src/lib/api-client.ts.
//
// If a future edit narrows `MoodTagsEnvelope` to a subset of
// `string | string[] | null | undefined` OR accidentally widens it
// with an extra arm, `expectTypeOf<...>().toEqualTypeOf<...>()`
// surfaces a TS2344 error and the project fails typecheck. This
// test is structurally pure -- vitest exercises it but the lock
// IS the type-equality assertion below (no unused locals needed).
//
// Four arms: array-shaped Drizzle jsonb round-trip + string-shaped
// JSON-stringified envelope + null + undefined (when the field is
// declared optional via `?:` on an outer-optional field).

import { describe, expectTypeOf, it } from "vitest";
import type { MoodTagsEnvelope } from "@/lib/api-client";

describe("api-client: MoodTagsEnvelope contract", () => {
  it("is exactly string | string[] | null | undefined", () => {
    expectTypeOf<MoodTagsEnvelope>().toEqualTypeOf<string | string[] | null | undefined>();
  });
});

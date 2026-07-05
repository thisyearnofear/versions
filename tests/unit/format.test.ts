// MODULAR: writer-side guard tests. The reader-side contract is locked
// in tests/unit/api-client-envelope.test.ts; this file locks the
// writer-side boundary so a future regression where someone inserts
// a JSON-stringified string into `mood_tags` / `aggregated_mood_tags`
// fails the test rather than corrupting the jsonb column.

import { describe, expect, expectTypeOf, it } from "vitest";
import { assertMoodTagsShape } from "@/lib/format";

describe("format: assertMoodTagsShape (writer-side guard)", () => {
  it("returns the same array reference on a canonical string[]", () => {
    const tags = ["Dreamy", "Polished", "Atmospheric"];
    const result = assertMoodTagsShape(tags);
    expect(result).toBe(tags);
    expect(result).toEqual(["Dreamy", "Polished", "Atmospheric"]);
  });

  it("returns an empty array unchanged", () => {
    const result = assertMoodTagsShape([]);
    expect(result).toEqual([]);
  });

  it("throws TypeError on a JSON-stringified string (the corruption vector)", () => {
    // MODULAR: this is the exact bug the guard prevents. Drizzle's
    // jsonb column would silently double-encode the value, landing
    // '"[\"tag\"]"' as a literal string instead of the array.
    expect(() => assertMoodTagsShape('["Dreamy","Polished"]')).toThrow(TypeError);
  });

  it("throws TypeError on null", () => {
    expect(() => assertMoodTagsShape(null)).toThrow(TypeError);
    expect(() => assertMoodTagsShape(null)).toThrow(/must be a string\[\]/);
  });

  it("throws TypeError on undefined", () => {
    expect(() => assertMoodTagsShape(undefined)).toThrow(TypeError);
  });

  it("throws TypeError on a mixed-shape array (one non-string entry)", () => {
    // The aggregateRatings output is a string[] by construction; if
    // an upstream helper ever leaks a number/object in, the guard
    // catches it before it lands in the column.
    expect(() => assertMoodTagsShape(["Dreamy", 7, "Atmospheric"])).toThrow(TypeError);
  });

  it("throws TypeError on a non-array primitive (number)", () => {
    expect(() => assertMoodTagsShape(42)).toThrow(TypeError);
  });

  it("throws TypeError on a non-array primitive (plain object)", () => {
    expect(() => assertMoodTagsShape({ tags: ["Dreamy"] })).toThrow(TypeError);
  });

  it("includes the explicit field name in the error message", () => {
    // MODULAR: when the publish gate or seed script throws, the
    // post-mortem log should name `aggregated_mood_tags`, not the
    // default `mood_tags`. The field parameter exists solely for
    // this diagnostic.
    expect(() => assertMoodTagsShape(null, "aggregated_mood_tags")).toThrow(
      /aggregated_mood_tags must be a string\[\]/,
    );
  });

  it("narrows unknown → string[] so Drizzle $type<string[]>() accepts the value", () => {
    // MODULAR: typecheck-only contract lock. If a future edit ever
    // returns `unknown` or `string[] | null` from assertMoodTagsShape,
    // the explicit `: string[]` annotation on the receiving side fails
    // TS2322. Symmetric with the reader-side lock in
    // tests/unit/api-client-envelope.test.ts. The unknown input
    // exercises the load-bearing narrowing path -- every wire-in
    // site relies on it so Drizzle's $type<string[]>() column accepts
    // the value without an explicit cast.
    const unknownInput: unknown = ["a", "b"];
    const tags: string[] = assertMoodTagsShape(unknownInput);
    expectTypeOf(tags).toEqualTypeOf<string[]>();
    expect(tags).toEqual(["a", "b"]);
  });
});

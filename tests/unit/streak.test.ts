// MODULAR: streak computation tests (src/services/listeners.ts →
// computeStreakDays). Pure function; covers consecutive-day logic
// including the "played yesterday, not yet today" alive-streak case.

import { describe, it, expect } from "vitest";
import { computeStreakDays } from "@/services/listeners";

const DAY = 86_400_000;

function dayIso(offsetDays: number, anchor: Date = new Date()): string {
  return new Date(anchor.getTime() - offsetDays * DAY).toISOString();
}

describe("computeStreakDays", () => {
  it("returns 0 for no plays", () => {
    expect(computeStreakDays([])).toBe(0);
  });

  it("counts a single play today as a 1-day streak", () => {
    const anchor = new Date();
    expect(computeStreakDays([dayIso(0, anchor)], anchor)).toBe(1);
  });

  it("counts consecutive days ending today", () => {
    const anchor = new Date();
    const plays = [dayIso(0, anchor), dayIso(1, anchor), dayIso(2, anchor)];
    expect(computeStreakDays(plays, anchor)).toBe(3);
  });

  it("keeps a streak alive when today has no play yet but yesterday did", () => {
    const anchor = new Date();
    const plays = [dayIso(1, anchor), dayIso(2, anchor), dayIso(3, anchor)];
    expect(computeStreakDays(plays, anchor)).toBe(3);
  });

  it("breaks the streak when a day is missed", () => {
    const anchor = new Date();
    const plays = [dayIso(0, anchor), dayIso(2, anchor)]; // gap on day 1
    expect(computeStreakDays(plays, anchor)).toBe(1);
  });

  it("dedupes multiple plays on the same day", () => {
    const anchor = new Date();
    const plays = [
      dayIso(0, anchor),
      new Date(anchor.getTime() - 2 * 3_600_000).toISOString(), // same day as today
      dayIso(1, anchor),
      dayIso(1, anchor),
    ];
    expect(computeStreakDays(plays, anchor)).toBe(2);
  });

  it("returns 0 when the last play is older than yesterday", () => {
    const anchor = new Date();
    const plays = [dayIso(5, anchor)];
    expect(computeStreakDays(plays, anchor)).toBe(0);
  });
});

// MODULAR: pure formatters shared by dropzone + audio player.

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * MODULAR: normalize the `aggregated_mood_tags` envelope to a
 * `string[]`. The api-client declares the field as `string | null`
 * (a JSON-stringified array envelope) but Drizzle's jsonb column
 * sometimes returns a real JS array on select -- so consumers
 * (FeedView, DiscoverView, ArtistDashboard) need to be tolerant of
 * BOTH wire shapes during the same render path. Pure function, no
 * react hook concerns. Returns `[]` for null / undefined / malformed
 * input so callers can pass `deriveValence(parseMoodTags(raw))` and
 * always receive a `string[]`. Always returns a fresh array (`.slice()`
 * on the array branch) so callers can mutate the result without
 * mutating the source row.
 */
export function parseMoodTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).slice() as string[];
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as string[];
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

export function fmtDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtTimecode(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * MODULAR: format a USDC micro-unit amount as a Lepton count.
 * 1 USDC = 1,000,000 micro-units = 1,000,000 leptons (per the
 * Lepton Agents Hackathon primitive: $0.000001 = 1 lepton, the
 * smallest settleable unit on Arc). Uses BigInt to avoid IEEE-754
 * rounding at sub-cent amounts.
 *
 * Examples:
 *   fmtLeptons(1)        // "1 lepton"
 *   fmtLeptons(10)       // "10 leptons"
 *   fmtLeptons(10_000)   // "10,000 leptons (1.00¢)"
 *   fmtLeptons(1_000_000) // "1,000,000 leptons ($1.00)"
 */
export function fmtLeptons(microUsdc: number | bigint): string {
  const micro = typeof microUsdc === "bigint" ? microUsdc : BigInt(Math.trunc(microUsdc));
  const leptons = micro.toString();
  const withCommas = leptons.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (micro < 1000n) {
    return `${withCommas} lepton${micro === 1n ? "" : "s"}`;
  }
  // Sub-cent: show as cents too
  if (micro < 100_000n) {
    const cents = Number(micro) / 1000;
    return `${withCommas} leptons (${cents.toFixed(cents < 10 ? 2 : 1)}¢)`;
  }
  // >= 10¢: show as USD too
  const usd = Number(micro) / 1_000_000;
  return `${withCommas} leptons ($${usd.toFixed(2)})`;
}

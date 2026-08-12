// MODULAR: Build a text surrogate for catalog embedding when the
// provider is text-only (OpenRouter). Combines track + placement brief.

import { parseMoodTags } from '../lib/format';

type CatalogVersion = {
  title: string;
  artistName: string;
  versionType: string | null;
  genre: string | null;
  aggregatedMoodTags: unknown;
};

type PlacementBrief = {
  sceneTags: string[] | null;
  instruments: string[] | null;
  emotionalArcs: string[] | null;
  audienceSummary: string | null;
} | null;

export function buildCatalogEmbedText(
  version: CatalogVersion,
  brief: PlacementBrief,
): string {
  const moods = parseMoodTags(version.aggregatedMoodTags).join(', ');
  const parts = [
    version.title,
    version.artistName,
    version.versionType,
    version.genre,
    moods,
    brief?.sceneTags?.join(', '),
    brief?.instruments?.join(', '),
    brief?.emotionalArcs?.join(', '),
    brief?.audienceSummary,
  ].filter((p) => typeof p === 'string' && p.trim().length > 0);
  return parts.join(' · ');
}

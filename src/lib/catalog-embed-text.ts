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

// ── Marketplace marketplace (listings + channels share one space) ──
// Both listing kinds and channel ethos are embedded into the SAME vector
// space so a single cosine query surfaces either kind against a channel
// profile. The text here must therefore be descriptive enough that the
// embed model can separate "lo-fi night drive" from "thriller tension".

export type ListingEmbedInput = {
  kind: string;
  title: string;
  supplierName: string;
  summary: string | null;
  tags: string[];
  tier: string;
};

export function buildListingEmbedText(input: ListingEmbedInput): string {
  const kindNoun = input.kind === 'music' ? 'music' : 'placement';
  const tierHint = input.tier === 'paid' ? 'paid placement' : 'free with attribution';
  const parts = [
    `${kindNoun}: ${input.title}`,
    `by ${input.supplierName}`,
    input.summary || '',
    input.tags.join(', '),
    tierHint,
  ].filter((p) => typeof p === 'string' && p.trim().length > 0);
  return parts.join(' · ');
}

export type ChannelEmbedInput = {
  name: string;
  niche: string | null;
  ethosSummary: string | null;
  platformDescription: string | null;
  recentContent: string[];
};

export function buildChannelEmbedText(input: ChannelEmbedInput): string {
  const parts = [
    input.niche ? `niche: ${input.niche}` : '',
    input.ethosSummary ? `about: ${input.ethosSummary}` : '',
    input.platformDescription ? `channel: ${input.platformDescription}` : '',
    `name: ${input.name}`,
    ...input.recentContent.slice(0, 12).map((line) => `recent: ${line}`),
  ].filter(Boolean);
  return parts.join('\n');
}

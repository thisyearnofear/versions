// MODULAR: Distribution-surface adapter. A channel must connect a REAL
// distribution surface, and the numbers come from the platform's public
// API — never from the channel's own form fields. Self-reported reach is
// the fraud vector that undermines ad marketplaces, so `StatsSource` in
// src/lib/types.ts deliberately has no 'self_reported' arm and this
// adapter is the only writer of channels.subscriber_count / view_count /
// video_count.
//
// PERFORMANT: mock-first, like every adapter here. With no YOUTUBE_API_KEY
// the probe resolves deterministically from the URL so onboarding, tests
// and the demo run with zero external dependencies. Mock results are
// tagged `mock: true` and the channels service holds verification at
// 'pending' rather than minting a verified channel out of invented
// numbers — a mock probe must never be able to unlock a paid slot.
//
// SAFE: `platformUrl` is parsed, never fetched. The only host this module
// requests is the pinned Google API base below, with caller input confined
// to URLSearchParams-encoded query values. No SSRF surface.
//
// QUOTA: two cheap calls per probe (channels.list = 1 unit,
// playlistItems.list = 1 unit). Recent uploads are read from the channel's
// own uploads playlist (UU + channel-id suffix) instead of search.list,
// which costs 100 units for the same titles.

import { createHash } from 'crypto';
import { requestJson } from '../lib/http';
import { log } from '../lib/logger';
import type { ChannelPlatform } from '../lib/types';

const GOOGLE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT = 10_000;
const MAX_RECENT_VIDEOS = 12;
const DESCRIPTION_CHARS = 160;

export interface ChannelProbeConfig {
  apiKey?: string;
  /** v1 resolves YouTube only; 'other' always probes in mock mode. */
  platform?: ChannelPlatform;
}

export interface PlatformChannelProbe {
  platform: ChannelPlatform;
  /** Canonical `/channel/UC…` form, so the unique index dedupes any URL the user pasted. */
  platformUrl: string;
  platformChannelId: string;
  name: string;
  description: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  /** Recent upload titles + descriptions — the channel-ethos embedding input. */
  recentContent: string[];
  /** True when the numbers were invented locally, not pulled from the platform. */
  mock: boolean;
  probedAt: string;
}

export interface ChannelProbeAdapter {
  mock: boolean;
  platform: ChannelPlatform;
  probe(platformUrl: string): Promise<PlatformChannelProbe>;
}

/** Raised for a URL we cannot turn into a channel reference. Callers surface it as a 400. */
export class ChannelUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelUrlError';
  }
}

export type ChannelRef =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'user'; value: string }
  | { kind: 'video'; value: string };

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * Turn anything a channel might paste into a resolvable reference. Accepts
 * /channel/UC…, /@handle, /user/name, legacy /c/name, a video link (which
 * resolves through the video's own channelId), or a bare `UC…` / `@handle`.
 */
export function parseChannelUrl(raw: string): ChannelRef {
  const input = (raw || '').trim();
  if (!input) throw new ChannelUrlError('A channel URL is required');

  if (/^UC[\w-]{22}$/.test(input)) return { kind: 'id', value: input };
  if (input.startsWith('@') && input.length > 1) {
    return { kind: 'handle', value: input.slice(0, 31) };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ChannelUrlError(`Not a URL: ${input.slice(0, 80)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ChannelUrlError('Channel URL must be http(s)');
  }
  const host = url.hostname.toLowerCase();
  if (!YT_HOSTS.has(host)) {
    throw new ChannelUrlError(`Unsupported platform host: ${host}`);
  }

  const segments = url.pathname.split('/').filter(Boolean);

  // A link to one of their uploads is a legitimate way to point at a
  // channel, so resolve the video and read its channelId.
  const videoId =
    host === 'youtu.be' || host === 'www.youtu.be'
      ? segments[0]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : null;
  if (videoId && /^[\w-]{11}$/.test(videoId)) return { kind: 'video', value: videoId };

  if (segments[0] === 'channel' && segments[1]) return { kind: 'id', value: segments[1] };
  if (segments[0] === 'user' && segments[1]) return { kind: 'user', value: segments[1] };
  if (segments[0] === 'c' && segments[1]) return { kind: 'handle', value: `@${segments[1]}` };
  if (segments[0]?.startsWith('@')) return { kind: 'handle', value: segments[0] };

  throw new ChannelUrlError(
    'Could not find a channel in that URL — paste a youtube.com/@handle or /channel/UC… link',
  );
}

/** Canonical URL for the unique index: always the id form once known. */
export function canonicalChannelUrl(channelId: string, fallback: string): string {
  return /^UC[\w-]{22}$/.test(channelId)
    ? `https://www.youtube.com/channel/${channelId}`
    : fallback;
}

type ChannelsResponse = {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; description?: string; customUrl?: string };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
};

type PlaylistItemsResponse = {
  items?: Array<{
    snippet?: { title?: string; description?: string };
  }>;
};

type VideosResponse = {
  items?: Array<{ id?: string; snippet?: { channelId?: string } }>;
};

function toCount(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/** Deterministic stand-in profile so the whole onboarding flow runs offline. */
function mockProbe(url: string, probedAt: string): PlatformChannelProbe {
  const hash = createHash('sha256').update(url.toLowerCase()).digest();
  const at = (offset: number, span: number, min: number) => min + (hash.readUInt32BE(offset) % span);
  const name = `Demo Channel ${hash.subarray(0, 3).toString('hex')}`;
  return {
    platform: 'youtube',
    platformUrl: url,
    platformChannelId: `UC${hash.subarray(0, 17).toString('base64url').padEnd(22, '0')}`,
    name,
    description: `Offline demo profile for ${url}. Set YOUTUBE_API_KEY to pull real distribution numbers.`,
    subscriberCount: at(0, 900_000, 1_000),
    viewCount: at(4, 90_000_000, 100_000),
    videoCount: at(8, 800, 10),
    recentContent: [
      `${name} — lo-fi study stream recap (demo)`,
      `${name} — weekly niche roundup (demo)`,
      `${name} — behind the automation (demo)`,
    ],
    mock: true,
    probedAt,
  };
}

export function createChannelProbeAdapter(
  config: ChannelProbeConfig = {},
): ChannelProbeAdapter {
  const apiKey = config.apiKey ?? process.env.YOUTUBE_API_KEY ?? '';
  const platform: ChannelPlatform = config.platform ?? 'youtube';
  // Anything that isn't a keyed YouTube probe is a mock. There is no
  // third state, because a channel verified against invented numbers is
  // exactly the fraud this adapter exists to prevent.
  const isMock = platform !== 'youtube' || !apiKey;

  async function listChannel(ref: ChannelRef): Promise<NonNullable<ChannelsResponse['items']>[number]> {
    const params = new URLSearchParams({ part: 'snippet,statistics', key: apiKey });
    if (ref.kind === 'id') params.set('id', ref.value);
    else if (ref.kind === 'handle') params.set('forHandle', ref.value);
    else params.set('forUsername', ref.value);

    const res = await requestJson<ChannelsResponse>(
      `${GOOGLE_API_BASE}/channels?${params}`,
      { timeoutMs: DEFAULT_TIMEOUT },
      'youtube.channels',
    );
    const item = res.items?.[0];
    if (!item?.id) {
      throw new ChannelUrlError('No YouTube channel matches that URL');
    }
    return item;
  }

  /** uploads playlist id = 'UU' + channel id minus its 'UC' prefix. */
  async function recentUploads(channelId: string): Promise<string[]> {
    if (!/^UC[\w-]{22}$/.test(channelId)) return [];
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: `UU${channelId.slice(2)}`,
      maxResults: String(MAX_RECENT_VIDEOS),
      key: apiKey,
    });
    const res = await requestJson<PlaylistItemsResponse>(
      `${GOOGLE_API_BASE}/playlistItems?${params}`,
      { timeoutMs: DEFAULT_TIMEOUT },
      'youtube.playlistItems',
    );
    return (res.items ?? [])
      .map((item) => {
        const title = item.snippet?.title?.trim() || '';
        const description = item.snippet?.description?.replace(/\s+/g, ' ').trim() || '';
        if (!title) return '';
        return description
          ? `${title} — ${description.slice(0, DESCRIPTION_CHARS)}`
          : title;
      })
      .filter(Boolean);
  }

  return {
    mock: isMock,
    platform,
    async probe(platformUrl: string): Promise<PlatformChannelProbe> {
      const probedAt = new Date().toISOString();
      if (isMock) return mockProbe(platformUrl.trim(), probedAt);

      let ref = parseChannelUrl(platformUrl);
      if (ref.kind === 'video') {
        // One extra unit to turn "here's a video I made" into a channel.
        const params = new URLSearchParams({ part: 'snippet', id: ref.value, key: apiKey });
        const res = await requestJson<VideosResponse>(
          `${GOOGLE_API_BASE}/videos?${params}`,
          { timeoutMs: DEFAULT_TIMEOUT },
          'youtube.videos',
        );
        const channelId = res.items?.[0]?.snippet?.channelId;
        if (!channelId) throw new ChannelUrlError('No YouTube video matches that URL');
        ref = { kind: 'id', value: channelId };
      }

      const channel = await listChannel(ref);
      const channelId = channel.id as string;
      const stats = channel.statistics ?? {};

      let recentContent: string[] = [];
      try {
        recentContent = await recentUploads(channelId);
      } catch (err) {
        // Ethos text degrades to the channel description; a quota or
        // playlist hiccup must not fail an otherwise-real verification.
        log.warn('recent uploads unavailable; ethos profile falls back to description', {
          channelId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        platform: 'youtube',
        platformUrl: canonicalChannelUrl(channelId, platformUrl.trim()),
        platformChannelId: channelId,
        name: channel.snippet?.title || channelId,
        description: channel.snippet?.description || '',
        subscriberCount: toCount(stats.subscriberCount),
        viewCount: toCount(stats.viewCount),
        videoCount: toCount(stats.videoCount),
        recentContent,
        mock: false,
        probedAt,
      };
    },
  };
}

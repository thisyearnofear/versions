import type { ListingRecord } from '../services/listings';
import type { ChannelRecord } from '../services/channels';
import type { SlotRecord, SlotLegRecord } from '../services/slots';
import type { UsageRecord } from '../services/usage';

export type { ListingRecord, ChannelRecord, SlotRecord, SlotLegRecord, UsageRecord };

export type MarketplaceListing = ListingRecord & {
  fit_score?: number;
  why_fits?: string[];
  similarity?: number | null;
};

export class MarketplaceError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'MarketplaceError';
  }
}

export async function marketplaceRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || body.data == null)
    throw new MarketplaceError(
      body?.error?.message ?? 'Could not complete this request. Please try again.',
      response.status,
      body?.error?.code ?? (response.ok ? 'RESPONSE_UNCONFIRMED' : undefined),
    );
  return body.data as T;
}

export function browseHref(
  { q, channelId, kind, tier }: { q?: string; channelId?: string; kind?: string; tier?: string } = {},
): string {
  const p = new URLSearchParams();
  if (q?.trim()) p.set('q', q.trim());
  if (channelId) p.set('channelId', channelId);
  if (kind === 'music' || kind === 'placement') p.set('kind', kind);
  if (tier === 'free' || tier === 'paid') p.set('tier', tier);
  return `/discover${p.size ? `?${p}` : ''}`;
}

export function searchHref(input: Parameters<typeof browseHref>[0] = {}, offset = 0): string {
  const p = new URLSearchParams(browseHref(input).split('?')[1] ?? '');
  p.set('limit', '20');
  p.set('offset', String(offset));
  return `/api/v1/marketplace/search?${p}`;
}

export function uploadAudioHref(audioPath: string): string {
  return `/api/v1/uploads/${encodeURIComponent(audioPath.split('/').pop() ?? '')}`;
}

export function mediaHref(raw: string): string | null {
  if (raw.startsWith('ipfs://')) return `https://gateway.pinata.cloud/ipfs/${raw.slice(7)}`;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function listingPriceLabel(listing: Pick<ListingRecord, 'tier' | 'pricing'>): string {
  if (listing.tier === 'free') return 'Free with required credit';
  if (listing.pricing?.model === 'flat' && listing.pricing.flatFeeUsdc)
    return `${listing.pricing.flatFeeUsdc} USDC · flat fee`;
  if (listing.pricing?.model === 'cpm' && listing.pricing.cpmUsdc)
    return `${listing.pricing.cpmUsdc} USDC per 1,000 impressions`;
  return 'Paid placement · pricing unavailable';
}

export function settlementLabel(
  slot: Pick<SlotRecord, 'payment_mock'>,
  leg: Pick<SlotLegRecord, 'status' | 'tx_hash'>,
): string {
  if (slot.payment_mock) return 'Demo settlement';
  return leg.status === 'settled' && !!leg.tx_hash ? 'Settled on Arc' : 'Settlement pending';
}

export function updateBrowseHref(current: string, patch: Record<string, string | null>): string {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '' || ((key === 'kind' || key === 'tier') && value === 'all'))
      params.delete(key);
    else params.set(key, value);
  }
  return `/discover${params.size ? `?${params}` : ''}`;
}

export function createRequestScope() {
  let controller: AbortController | null = null;
  let version = 0;
  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const token = ++version;
      return { signal, isCurrent: () => token === version && !signal.aborted };
    },
    cancel() {
      version++;
      controller?.abort();
    },
  };
}

export function parseUsageCount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return 0;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= 100_000_000 ? n : null;
}

export function publishedUrl(raw: string): string | null {
  const s = raw.trim();
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

export interface ReservePlacementResult {
  slot: SlotRecord;
  alreadyExisted: boolean;
}

export async function reservePlacement(
  listingId: string,
  channelId: string,
  budgetUsdc: string | null,
): Promise<ReservePlacementResult> {
  return marketplaceRequest<ReservePlacementResult>('/api/v1/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingId, channelId, budgetUsdc }),
  });
}

export interface PayPlacementResult {
  slot: SlotRecord;
  charged_usdc: string;
  tx_hash: string | null;
  mock: boolean;
  legs: SlotLegRecord[];
}

export async function payPlacement(slotId: string): Promise<PayPlacementResult> {
  return marketplaceRequest<PayPlacementResult>(`/api/v1/slots/${encodeURIComponent(slotId)}/pay`, {
    method: 'POST',
  });
}

export async function completePlacement(slotId: string): Promise<PayPlacementResult> {
  return marketplaceRequest<PayPlacementResult>(`/api/v1/slots/${encodeURIComponent(slotId)}/complete`, {
    method: 'POST',
  });
}

export async function setPlacementAction(slotId: string, action: 'pause' | 'resume'): Promise<SlotRecord> {
  const data = await marketplaceRequest<{ slot: SlotRecord }>(`/api/v1/slots/${encodeURIComponent(slotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return data.slot;
}

export interface ReportUsageInput {
  listingId: string;
  channelId: string;
  slotId?: string | null;
  videoUrl?: string | null;
  impressions?: number;
  clicks?: number;
}

export async function reportPlacementUsage(input: ReportUsageInput): Promise<UsageRecord> {
  const data = await marketplaceRequest<{ usage: UsageRecord }>('/api/v1/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listingId: input.listingId,
      channelId: input.channelId,
      slotId: input.slotId ?? null,
      videoUrl: input.videoUrl ?? null,
      impressions: input.impressions,
      clicks: input.clicks,
    }),
  });
  return data.usage;
}

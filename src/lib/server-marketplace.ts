// MODULAR: server-side marketplace reads that work in both modes:
//   - monolith: call services() in-process
//   - split UI: HTTP to NEXT_PUBLIC_API_URL or INTERNAL_API_URL (box)
// So listing RSC / sitemap / OG can live on Netlify without a DB pool.

import { apiUrl, getApiBase } from "./api-base";
import type { ListingRecord } from "../services/listings";

function remoteApiOrigin(): string {
  const internal = (process.env.INTERNAL_API_URL ?? "").replace(/\/$/, "");
  if (internal) return internal;
  return getApiBase();
}

/** True when this process should fetch marketplace data over HTTP. */
export function usesRemoteMarketplaceApi(): boolean {
  return Boolean(remoteApiOrigin());
}

function remoteUrl(path: string): string {
  const origin = remoteApiOrigin();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!origin) return apiUrl(normalized);
  return `${origin}${normalized}`;
}

type Envelope<T> = { success?: boolean; data?: T };

async function remoteJson<T>(path: string): Promise<T | null> {
  const res = await fetch(remoteUrl(path), { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body?.success || body.data == null) return null;
  return body.data;
}

export async function fetchListingById(id: string): Promise<ListingRecord | null> {
  if (!usesRemoteMarketplaceApi()) {
    const { services } = await import("./services");
    return services().listings.get(id);
  }
  const data = await remoteJson<{ listing: ListingRecord }>(
    `/api/v1/listings/${encodeURIComponent(id)}`,
  );
  return data?.listing ?? null;
}

export async function fetchActiveListingIds(limit = 500): Promise<
  Array<{ id: string; updatedAt: Date | string | null }>
> {
  if (!usesRemoteMarketplaceApi()) {
    const { services } = await import("./services");
    const rows = await services().listings.listActive({ limit });
    return rows.map((r) => ({ id: r.id, updatedAt: r.updated_at ?? null }));
  }
  const data = await remoteJson<{ listings: ListingRecord[] }>(
    `/api/v1/listings?limit=${limit}`,
  );
  return (data?.listings ?? []).map((r) => ({
    id: r.id,
    updatedAt: r.updated_at || null,
  }));
}

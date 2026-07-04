// MODULAR: Small in-process TTL cache.
//
// Used for read-heavy endpoints (feed list, playlist list) where
// short-window caching absorbs the burst right after a publish
// event without round-tripping to the DB.
//
// PERFORMANT: O(1) reads. Bounded size (oldest entries are evicted
//             on overflow). No external dependencies.
//
// CLEAN: the cache is best-effort — on cold start or after a Lambda
//        recycle we just rebuild. We never cache anything that
//        contains a wallet or signed payload (caller's job to avoid
//        passing PII to cache()).
//
// DRY: invalidation hooks into the event-bus. When a 'feed-update'
//     or 'playlist-update' event fires, the relevant keys are
//     cleared so the next read hits the DB and rehydrates.

import { subscribe, type EventName } from './event-bus';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

interface CacheRecord {
  store: Map<string, Entry<unknown>>;
  invalidators: Map<EventName, Set<string>>;
}

const MAX_ENTRIES = 256;

function makeRecord(): CacheRecord {
  return {
    store: new Map<string, Entry<unknown>>(),
    invalidators: new Map<EventName, Set<string>>(),
  };
}

const cache: CacheRecord = makeRecord();

function nowMs(): number {
  return Date.now();
}

function prune(now: number, store: Map<string, Entry<unknown>>): void {
  let removed = 0;
  for (const [k, e] of store) {
    if (e.expiresAt <= now) {
      store.delete(k);
      removed++;
    }
    if (store.size <= MAX_ENTRIES) break;
  }
  // Also enforce cap by dropping oldest first.
  if (store.size > MAX_ENTRIES) {
    const overflow = store.size - MAX_ENTRIES;
    let dropped = 0;
    for (const k of store.keys()) {
      if (dropped >= overflow) break;
      store.delete(k);
      dropped++;
    }
  }
}

/**
 * Look up `key` in the cache. If fresh, return its value; otherwise
 * call `loader`, store its result for `ttlMs`, and return it.
 *
 * Pass `invalidateOn` to automatically clear the cached value when
 * one of those events fires. (Bus subscriptions are stored
 * globally; this is safe across multiple cache() calls with the
 * same event name.)
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  invalidateOn?: EventName[],
): Promise<T> {
  const now = nowMs();
  prune(now, cache.store);
  const hit = cache.store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const value = await loader();
  cache.store.set(key, { value, expiresAt: now + ttlMs });

  if (invalidateOn) {
    for (const evt of invalidateOn) {
      let set = cache.invalidators.get(evt);
      if (!set) {
        set = new Set<string>();
        cache.invalidators.set(evt, set);
        subscribe(evt, () => {
          const keys = cache.invalidators.get(evt);
          if (!keys) return;
          for (const k of keys) cache.store.delete(k);
        });
      }
      set.add(key);
    }
  }

  return value;
}

/**
 * Manually invalidate a key. Useful after non-event-bus writes
 * (tests, ad-hoc invalidation).
 */
export function invalidate(key: string): void {
  cache.store.delete(key);
}

/**
 * Clear the entire cache. Mostly for tests.
 */
export function clearCache(): void {
  cache.store.clear();
  // Keep invalidator registrations so the bus subscriptions persist.
}

/**
 * Quick stats for the /health/ready route.
 */
export function cacheStats(): { entries: number; invalidators: number } {
  return {
    entries: cache.store.size,
    invalidators: Array.from(cache.invalidators.values()).reduce(
      (n, s) => n + s.size,
      0,
    ),
  };
}

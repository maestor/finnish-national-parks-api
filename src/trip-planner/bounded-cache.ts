export type BoundedTtlCache<T> = {
  get: (key: string) => T | undefined;
  getEntryCount: () => number;
  getSizeBytes: () => number;
  set: (key: string, value: T, ttlMs: number) => boolean;
};

type BoundedTtlCacheOptions<T> = {
  estimateBytes?: ((value: T) => number) | undefined;
  maxBytes?: number | undefined;
  maxEntries: number;
  now?: (() => number) | undefined;
};

type CacheEntry<T> = {
  expiresAt: number;
  sizeBytes: number;
  value: T;
};

export const createBoundedTtlCache = <T>({
  estimateBytes = () => 0,
  maxBytes,
  maxEntries,
  now = Date.now
}: BoundedTtlCacheOptions<T>): BoundedTtlCache<T> => {
  const entries = new Map<string, CacheEntry<T>>();
  let sizeBytes = 0;

  const removeExpired = (currentTime: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) {
        entries.delete(key);
        sizeBytes -= entry.sizeBytes;
      }
    }
  };

  const get = (key: string) => {
    removeExpired(now());
    const entry = entries.get(key);

    if (!entry) {
      return undefined;
    }

    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  };

  const set = (key: string, value: T, ttlMs: number) => {
    removeExpired(now());
    const size = Math.max(0, estimateBytes(value));

    if (maxBytes !== undefined && size > maxBytes) {
      return false;
    }

    const previousEntry = entries.get(key);
    if (previousEntry) {
      entries.delete(key);
      sizeBytes -= previousEntry.sizeBytes;
    }

    entries.set(key, {
      expiresAt: now() + ttlMs,
      sizeBytes: size,
      value
    });
    sizeBytes += size;

    while (entries.size > maxEntries || (maxBytes !== undefined && sizeBytes > maxBytes)) {
      const oldestEntry = entries.entries().next().value as [string, CacheEntry<T>];
      entries.delete(oldestEntry[0]);
      sizeBytes -= oldestEntry[1].sizeBytes;
    }

    return true;
  };

  return {
    get,
    getEntryCount: () => entries.size,
    getSizeBytes: () => sizeBytes,
    set
  };
};

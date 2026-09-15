import { describe, expect, it } from 'vitest';

import { createBoundedTtlCache } from '../../src/trip-planner/bounded-cache.js';

describe('bounded TTL cache', () => {
  it('expires entries, promotes recent reads, and evicts by entry and byte limits', () => {
    let now = 1_000;
    const cache = createBoundedTtlCache({
      estimateBytes: (value: string) => value.length,
      maxBytes: 6,
      maxEntries: 2,
      now: () => now
    });

    expect(cache.set('one', '123', 100)).toBe(true);
    expect(cache.set('two', '456', 100)).toBe(true);
    expect(cache.getEntryCount()).toBe(2);
    expect(cache.getSizeBytes()).toBe(6);

    expect(cache.get('one')).toBe('123');
    expect(cache.set('three', '789', 100)).toBe(true);
    expect(cache.get('two')).toBeUndefined();
    expect(cache.getEntryCount()).toBe(2);

    expect(cache.set('too-large', '1234567', 100)).toBe(false);
    expect(cache.getEntryCount()).toBe(2);

    now += 101;
    expect(cache.get('one')).toBeUndefined();
    expect(cache.getEntryCount()).toBe(0);
    expect(cache.getSizeBytes()).toBe(0);
  });

  it('allows a replacement value and preserves null values', () => {
    const cache = createBoundedTtlCache<null | string>({
      maxEntries: 2,
      now: () => 1_000
    });

    expect(cache.set('value', null, 100)).toBe(true);
    expect(cache.get('value')).toBeNull();
    expect(cache.set('value', 'updated', 100)).toBe(true);
    expect(cache.get('value')).toBe('updated');
    expect(cache.getEntryCount()).toBe(1);
  });
});

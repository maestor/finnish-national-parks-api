import { describe, expect, it } from 'vitest';

import { createMemoryStorage } from '../../../src/storage/memory-storage.js';

describe('createMemoryStorage', () => {
  it('stores and retrieves buffers in memory', async () => {
    const storage = createMemoryStorage();
    const buffer = Buffer.from('hello');

    await storage.upload('test/key.txt', buffer, 'text/plain');

    expect(storage.getStore().get('test/key.txt')).toEqual(buffer);
  });

  it('generates predictable test URLs', () => {
    const storage = createMemoryStorage();

    expect(storage.getPublicUrl('foo.jpg')).toBe('https://memory-storage.test/foo.jpg');
  });

  it('removes stored buffers on delete', async () => {
    const storage = createMemoryStorage();

    await storage.upload('a.txt', Buffer.from('a'), 'text/plain');
    await storage.delete('a.txt');

    expect(storage.getStore().has('a.txt')).toBe(false);
  });

  it('does not throw when deleting a missing key', async () => {
    const storage = createMemoryStorage();

    await expect(storage.delete('missing')).resolves.toBeUndefined();
  });
});

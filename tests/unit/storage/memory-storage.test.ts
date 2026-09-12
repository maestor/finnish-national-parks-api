import { describe, expect, it } from 'vitest';

import { createMemoryStorage } from '../../../src/storage/memory-storage.js';

describe('createMemoryStorage', () => {
  it('stores and retrieves buffers in memory', async () => {
    const storage = createMemoryStorage();
    const buffer = Buffer.from('hello');

    await storage.upload('test/key.txt', buffer, 'text/plain');

    expect(storage.getStore().get('test/key.txt')).toEqual(buffer);
  });

  it('generates predictable test URLs', async () => {
    const storage = createMemoryStorage();

    expect(await storage.getPresignedUrl('foo.jpg', 3600)).toBe(
      'https://memory-storage.test/foo.jpg'
    );
    expect(await storage.getPresignedUploadUrl('foo.jpg', 'image/jpeg', 900)).toBe(
      'https://memory-storage-upload.test/foo.jpg'
    );
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

  it('returns stored object metadata when a key exists', async () => {
    const storage = createMemoryStorage();

    await storage.upload('photo.jpg', Buffer.from('hello'), 'image/jpeg');

    await expect(storage.getObjectMetadata('photo.jpg')).resolves.toEqual({
      contentLength: 5,
      contentType: 'image/jpeg'
    });
    await expect(storage.getObjectMetadata('missing.jpg')).resolves.toBeNull();
  });

  it('returns a stored object buffer or null when it is missing', async () => {
    const storage = createMemoryStorage();
    const buffer = Buffer.from('photo');

    await storage.upload('photo.jpg', buffer, 'image/jpeg');

    await expect(storage.getObject('photo.jpg')).resolves.toEqual(buffer);
    await expect(storage.getObject('missing.jpg')).resolves.toBeNull();
  });
});

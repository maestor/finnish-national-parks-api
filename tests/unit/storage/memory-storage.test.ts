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

  it('enforces a maximum object read size', async () => {
    const storage = createMemoryStorage();

    await storage.upload('oversized.jpg', Buffer.from('photo'), 'image/jpeg');

    await expect(storage.getObject('oversized.jpg', { maxBytes: 4 })).rejects.toThrow(
      'Stored object exceeds the configured read limit.'
    );
  });

  it('lists objects by prefix in pages with object metadata', async () => {
    const storage = createMemoryStorage();
    await storage.upload('visits/a.jpg', Buffer.from('a'), 'image/jpeg');
    await storage.upload('visits/b.jpg', Buffer.from('bb'), 'image/jpeg');
    storage.getStore().set('visits/legacy-without-metadata.jpg', Buffer.from('legacy'));

    const firstPage = await storage.listObjects({ limit: 1, prefix: 'visits/' });
    const secondPage = await storage.listObjects({
      ...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {}),
      limit: 10,
      prefix: 'visits/'
    });

    expect(firstPage).toMatchObject({
      items: [{ key: 'visits/a.jpg', size: 1 }],
      nextCursor: 'visits/a.jpg'
    });
    expect(secondPage).toMatchObject({
      items: [
        { key: 'visits/b.jpg', size: 2 },
        { key: 'visits/legacy-without-metadata.jpg', lastModified: null, size: null }
      ],
      nextCursor: null
    });

    await expect(storage.listObjects({ limit: 0, prefix: 'visits/' })).resolves.toMatchObject({
      items: [],
      nextCursor: null
    });
  });
});

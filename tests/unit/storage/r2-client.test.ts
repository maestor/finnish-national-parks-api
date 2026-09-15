import { GetObjectCommand, HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { createR2Client } from '../../../src/storage/r2-client.js';
import { StorageObjectTooLargeError } from '../../../src/storage/types.js';

const createClient = (send: ReturnType<typeof vi.fn>) => {
  return createR2Client({
    accessKeyId: 'access-key',
    bucketName: 'bucket',
    client: { send } as unknown as S3Client,
    endpoint: 'https://r2.example.test',
    secretAccessKey: 'secret-access-key'
  });
};

const createBody = (chunks: Uint8Array[], closeWhenDone = true) => {
  let index = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    cancel,
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) {
        controller.enqueue(chunk);
      } else if (closeWhenDone) {
        controller.close();
      }
    }
  });

  return {
    cancel,
    transformToWebStream: () => stream
  };
};

describe('createR2Client bounded reads', () => {
  it('reads a valid streamed object after metadata and preserves the bytes', async () => {
    const send = vi.fn();
    const body = createBody([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 4, ContentType: 'image/jpeg' };
      }

      expect(command).toBeInstanceOf(GetObjectCommand);
      return { Body: body, ContentLength: 4 };
    });
    const storage = createClient(send);

    await expect(storage.getObjectMetadata('staged.jpg')).resolves.toEqual({
      contentLength: 4,
      contentType: 'image/jpeg'
    });
    await expect(storage.getObject('staged.jpg', { maxBytes: 4 })).resolves.toEqual(
      Buffer.from([1, 2, 3, 4])
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rejects a declared oversized object without reading its body', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToWebStream: vi.fn() },
      ContentLength: 5
    });
    const storage = createClient(send);

    await expect(storage.getObject('oversized.jpg', { maxBytes: 4 })).rejects.toBeInstanceOf(
      StorageObjectTooLargeError
    );
    const response = await send.mock.results[0]!.value;
    expect(response.Body.transformToWebStream).not.toHaveBeenCalled();
  });

  it('cancels a stream as soon as received bytes exceed the limit', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: createBody([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])], false)
    });
    const storage = createClient(send);

    await expect(storage.getObject('oversized-stream.jpg', { maxBytes: 4 })).rejects.toBeInstanceOf(
      StorageObjectTooLargeError
    );
    const response = await send.mock.results[0]!.value;
    expect(response.Body.cancel).toHaveBeenCalled();
  });

  it('cancels a body when the finite read deadline expires', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      pull() {
        return new Promise<void>(() => undefined);
      }
    });
    const body = {
      transformToWebStream: () => stream
    };
    const send = vi.fn().mockResolvedValue({ Body: body });
    const storage = createClient(send);

    await expect(storage.getObject('hung.jpg', { timeoutMs: 1 })).rejects.toThrow(
      'Storage read timed out.'
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('returns null for a missing object', async () => {
    const send = vi.fn().mockRejectedValue({ name: 'NoSuchKey' });
    const storage = createClient(send);

    await expect(storage.getObject('missing.jpg')).resolves.toBeNull();
  });
});

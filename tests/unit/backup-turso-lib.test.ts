import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableReplicaBootstrapError,
  openBackupReplicaClient
} from '../../src/cli/backup-turso-lib.js';

describe('backup turso bootstrap retry', () => {
  it('detects the transient replica bootstrap EOF failure as retryable', () => {
    expect(
      isRetryableReplicaBootstrapError(
        new Error(
          'Sync(HttpBody(hyper::Error(Body, Custom { kind: UnexpectedEof, error: "unexpected EOF during chunk size line" })))'
        )
      )
    ).toBe(true);

    expect(isRetryableReplicaBootstrapError(new Error('permission denied'))).toBe(false);
  });

  it('retries when replica client creation throws a transient EOF error', async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const client = {
      close: vi.fn(),
      sync: vi.fn(async () => ({ frame_no: 10, frames_synced: 10 }))
    };
    const createReplicaClient = vi
      .fn<() => typeof client>()
      .mockImplementationOnce(() => {
        throw new Error(
          'Sync(HttpBody(hyper::Error(Body, Custom { kind: UnexpectedEof, error: "unexpected EOF during chunk size line" })))'
        );
      })
      .mockReturnValue(client);

    const result = await openBackupReplicaClient({
      createReplicaClient,
      onRetry,
      sleep
    });

    expect(createReplicaClient).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      client,
      replication: {
        frame_no: 10,
        frames_synced: 10
      }
    });
  });

  it('closes the failed replica client before retrying a transient sync error', async () => {
    const sleep = vi.fn(async () => {});
    const firstClient = {
      close: vi.fn(),
      sync: vi.fn(async () => {
        throw new Error(
          'Sync(HttpBody(hyper::Error(Body, Custom { kind: UnexpectedEof, error: "unexpected EOF during chunk size line" })))'
        );
      })
    };
    const secondClient = {
      close: vi.fn(),
      sync: vi.fn(async () => ({ frame_no: 12, frames_synced: 2 }))
    };
    const createReplicaClient = vi
      .fn<() => typeof firstClient | typeof secondClient>()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);

    const result = await openBackupReplicaClient({
      createReplicaClient,
      sleep
    });

    expect(firstClient.close).toHaveBeenCalledTimes(1);
    expect(secondClient.close).not.toHaveBeenCalled();
    expect(result).toEqual({
      client: secondClient,
      replication: {
        frame_no: 12,
        frames_synced: 2
      }
    });
  });

  it('does not retry non-transient failures', async () => {
    const sleep = vi.fn(async () => {});
    const client = {
      close: vi.fn(),
      sync: vi.fn(async () => {
        throw new Error('permission denied');
      })
    };

    await expect(
      openBackupReplicaClient({
        createReplicaClient: () => client,
        sleep
      })
    ).rejects.toThrow('permission denied');

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

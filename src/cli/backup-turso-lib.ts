import type { Client } from '@libsql/client';

type BackupReplicationResult = Awaited<ReturnType<Client['sync']>>;

type BackupReplicaClient = Pick<Client, 'close' | 'sync'>;

type OpenBackupReplicaClientOptions<TClient extends BackupReplicaClient> = {
  createReplicaClient: () => TClient;
  maxAttempts?: number;
  onRetry?:
    | ((details: { attempt: number; delayMs: number; error: unknown; maxAttempts: number }) => void)
    | undefined;
  retryDelayMs?: number;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
};

const RETRYABLE_REPLICA_BOOTSTRAP_PATTERNS = [
  'UnexpectedEof',
  'unexpected EOF during chunk size line'
];

const delay = async (milliseconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const isRetryableReplicaBootstrapError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  return RETRYABLE_REPLICA_BOOTSTRAP_PATTERNS.some((pattern) => message.includes(pattern));
};

export const openBackupReplicaClient = async <TClient extends BackupReplicaClient>({
  createReplicaClient,
  maxAttempts = 3,
  onRetry,
  retryDelayMs = 1_000,
  sleep = delay
}: OpenBackupReplicaClientOptions<TClient>): Promise<{
  client: TClient;
  replication: BackupReplicationResult;
}> => {
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    let client: TClient | undefined;

    try {
      client = createReplicaClient();
      const replication = await client.sync();

      return {
        client,
        replication
      };
    } catch (error) {
      client?.close();

      if (attempt >= maxAttempts || !isRetryableReplicaBootstrapError(error)) {
        throw error;
      }

      onRetry?.({
        attempt,
        delayMs: retryDelayMs,
        error,
        maxAttempts
      });

      await sleep(retryDelayMs);
    }
  }

  throw new Error('Backup replica bootstrap attempts exhausted.');
};

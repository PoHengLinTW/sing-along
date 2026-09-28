import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3Storage } from './s3';

function fakeClient() {
  const sent: unknown[] = [];
  return { sent, client: { send: async (cmd: unknown) => void sent.push(cmd) } as never };
}

describe('S3Storage.deleteObjects', () => {
  it('does nothing for an empty list', async () => {
    const f = fakeClient();
    await new S3Storage(f.client, 'bkt').deleteObjects([]);
    expect(f.sent).toHaveLength(0);
  });

  it('deletes keys from the configured bucket', async () => {
    const f = fakeClient();
    await new S3Storage(f.client, 'bkt').deleteObjects(['a', 'b']);
    const cmd = f.sent[0] as DeleteObjectsCommand;
    expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
    expect(cmd.input.Bucket).toBe('bkt');
    expect(cmd.input.Delete?.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }]);
  });

  it('batches in groups of 1000 (the S3 API limit)', async () => {
    const f = fakeClient();
    await new S3Storage(f.client, 'bkt').deleteObjects(
      Array.from({ length: 2500 }, (_, i) => `k${i}`),
    );
    expect(f.sent).toHaveLength(3);
  });
});

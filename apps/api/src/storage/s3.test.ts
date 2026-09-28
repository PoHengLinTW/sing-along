import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createS3Client, S3Storage } from './s3';

const cfg = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000',
  region: 'auto',
  bucket: 'sing-along-test',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true,
};

function fakeClient() {
  const sent: unknown[] = [];
  return {
    sent,
    client: { send: async (cmd: unknown) => void sent.push(cmd) } as unknown as S3Client,
  };
}

describe('S3Storage.deleteObjects (mocked client)', () => {
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

describe('S3Storage.presignPut (offline signing)', () => {
  const storage = new S3Storage(createS3Client(cfg), 'bkt');

  it('signs Content-Type and Content-Length and expires as requested', async () => {
    const url = new URL(
      await storage.presignPut({
        key: 'p/1/t/2.flac',
        contentType: 'audio/flac',
        sizeBytes: 1000,
        expiresInSec: 900,
      }),
    );
    expect(url.pathname).toBe('/bkt/p/1/t/2.flac');
    const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed).toContain('content-length');
    expect(signed).toContain('content-type');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });
});

// Real round trip against the dev/CI S3 stand-in (RustFS). Skipped when it isn't running.
async function s3Reachable(): Promise<boolean> {
  try {
    await fetch(cfg.endpoint, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!(await s3Reachable()))('S3Storage against the S3 stand-in', () => {
  const client = createS3Client(cfg);
  const storage = new S3Storage(client, cfg.bucket);
  const key = `it/${Date.now()}.flac`;

  const put = (url: string, size: number, type = 'audio/flac') =>
    fetch(url, { method: 'PUT', body: Buffer.alloc(size, 1), headers: { 'content-type': type } });

  it('accepts the exact size/type, and rejects a different size or type', async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    }
    const url = await storage.presignPut({
      key,
      contentType: 'audio/flac',
      sizeBytes: 1000,
      expiresInSec: 60,
    });
    expect((await put(url, 2000)).status).toBeGreaterThanOrEqual(400);
    expect((await put(url, 1000, 'text/plain')).status).toBeGreaterThanOrEqual(400);
    expect(await storage.head(key)).toBeNull();
    expect((await put(url, 1000)).status).toBe(200);
  });

  it('heads, presigns a GET, and deletes', async () => {
    expect(await storage.head(key)).toMatchObject({ sizeBytes: 1000, contentType: 'audio/flac' });
    const get = await fetch(await storage.presignGet({ key, expiresInSec: 60 }));
    expect(get.status).toBe(200);
    expect((await get.arrayBuffer()).byteLength).toBe(1000);
    await storage.deleteObjects([key]);
    expect(await storage.head(key)).toBeNull();
  });
});

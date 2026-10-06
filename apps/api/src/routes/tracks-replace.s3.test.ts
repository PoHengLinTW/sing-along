import { CreateBucketCommand, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { projects, tracks } from '../db/schema';
import { createS3Client, S3Storage } from '../storage/s3';
import { createTestDb } from '../test/db';

// A real round trip through the S3 stand-in (RustFS): the presigned PUT of the replacement, the
// HEAD check, and the deletion of the old object. Skipped when the stand-in is not running.
const cfg = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? 'http://localhost:9000',
  region: 'auto',
  bucket: 'sing-along-test-replace', // its own bucket: nothing else shares or is hurt by the clean-up below
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? 'minioadmin',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? 'minioadmin',
  forcePathStyle: true,
};
async function s3Reachable(): Promise<boolean> {
  try {
    await fetch(cfg.endpoint, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!(await s3Reachable()))('replacing a track against the S3 stand-in', () => {
  const client = createS3Client(cfg);
  const storage = new S3Storage(client, cfg.bucket);
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: FastifyInstance;
  let projectId: number;

  beforeAll(async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
    }
    t = await createTestDb();
    app = buildApp({ db: t.db, storage, presignTtlSec: 60 });
    // Every run starts with fresh databases, so project and track ids repeat: clear what an
    // earlier run left under the ids this one will use.
    const stale = await keysIn('projects/');
    if (stale.length) await storage.deleteObjects(stale);
    const [p] = await t.db.insert(projects).values({ title: 'Real S3' }).returning();
    projectId = p?.id as number;
  });
  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  const keysIn = async (prefix: string) => {
    const res = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix }));
    return (res.Contents ?? []).map((o) => o.Key as string).sort();
  };
  // Exactly this track's objects: "tracks/1." and "tracks/1-", never "tracks/10" or "tracks/12-".
  const keysOf = async (trackId: number) => [
    ...(await keysIn(`projects/${projectId}/tracks/${trackId}.`)),
    ...(await keysIn(`projects/${projectId}/tracks/${trackId}-`)),
  ];
  const put = (url: string, size: number, type: string) =>
    fetch(url, { method: 'PUT', body: Buffer.alloc(size, 7), headers: { 'content-type': type } });

  async function savedTrack(size = 3000) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tracks/upload-url`,
      payload: {
        name: 'Alto',
        mimeType: 'audio/flac',
        sizeBytes: size,
        durationMs: 6000,
        source: 'upload',
        peaks: [0.5],
      },
    });
    const { trackId, uploadUrl } = res.json();
    expect((await put(uploadUrl, size, 'audio/flac')).ok).toBe(true);
    expect(
      (await app.inject({ method: 'POST', url: `/api/tracks/${trackId}/confirm` })).statusCode,
    ).toBe(200);
    return trackId as number;
  }

  async function replaceWith(trackId: number, size: number, durationMs: number) {
    const ask = await app.inject({
      method: 'POST',
      url: `/api/tracks/${trackId}/replace-url`,
      payload: { mimeType: 'audio/flac', sizeBytes: size, durationMs },
    });
    expect(ask.statusCode).toBe(200);
    const { key, uploadUrl } = ask.json();
    expect((await put(uploadUrl, size, 'audio/flac')).ok).toBe(true);
    const res = await app.inject({
      method: 'POST',
      url: `/api/tracks/${trackId}/replace`,
      payload: { key, mimeType: 'audio/flac', sizeBytes: size, durationMs, peaks: [0.2, 0.4] },
    });
    return { res, key };
  }

  it('uploads to a new key, swaps the track over and deletes the old file from storage', async () => {
    const id = await savedTrack(3000);
    const before = await keysOf(id);
    expect(before).toHaveLength(1);

    const { res, key } = await replaceWith(id, 1500, 3000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ durationMs: 3000, sizeBytes: 1500 });

    const after = await keysOf(id);
    expect(after).toEqual([key]); // the old object is gone, the new one is there
    expect(after).not.toEqual(before);
  });

  it('serves the new file, with the new size, from the audio URL', async () => {
    const id = await savedTrack(3000);
    await replaceWith(id, 1234, 2000);
    const { url } = (
      await app.inject({ method: 'GET', url: `/api/tracks/${id}/audio-url` })
    ).json();
    const file = await fetch(url);
    expect(file.ok).toBe(true);
    expect((await file.arrayBuffer()).byteLength).toBe(1234);
  });

  it('the last of two replacements wins and leaves one object behind', async () => {
    const id = await savedTrack(3000);
    await replaceWith(id, 1000, 1000);
    const second = await replaceWith(id, 2000, 2000);
    expect(await keysOf(id)).toEqual([second.key]);
    const [row] = await t.db.select().from(tracks).where(eq(tracks.id, id));
    expect(row).toMatchObject({ sizeBytes: 2000, durationMs: 2000, storageKey: second.key });
  });

  it('refuses a replacement whose uploaded size differs, removes it, and keeps the old file', async () => {
    const id = await savedTrack(3000);
    const ask = (
      await app.inject({
        method: 'POST',
        url: `/api/tracks/${id}/replace-url`,
        payload: { mimeType: 'audio/flac', sizeBytes: 900, durationMs: 1000 },
      })
    ).json();
    expect((await put(ask.uploadUrl, 900, 'audio/flac')).ok).toBe(true);
    const res = await app.inject({
      method: 'POST',
      url: `/api/tracks/${id}/replace`,
      payload: {
        key: ask.key,
        mimeType: 'audio/flac',
        sizeBytes: 901,
        durationMs: 1000,
        peaks: [0],
      },
    });
    expect(res.statusCode).toBe(400);
    const keys = await keysOf(id);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(ask.key);
  });

  it('the signed upload only accepts the announced size', async () => {
    const id = await savedTrack(3000);
    const ask = (
      await app.inject({
        method: 'POST',
        url: `/api/tracks/${id}/replace-url`,
        payload: { mimeType: 'audio/flac', sizeBytes: 500, durationMs: 1000 },
      })
    ).json();
    expect((await put(ask.uploadUrl, 501, 'audio/flac')).ok).toBe(false);
  });
});

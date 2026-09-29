import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import type { ListedObject, ObjectInfo, Storage } from './types';

export function createS3Client(s3: Config['s3']): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    // Presigned PUTs must not carry checksum headers the browser can't compute.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export class S3Storage implements Storage {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}

  presignPut({
    key,
    contentType,
    sizeBytes,
    expiresInSec,
  }: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSec: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      {
        expiresIn: expiresInSec,
        // Sign both headers so storage rejects a PUT with another type or size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  presignGet({ key, expiresInSec }: { key: string; expiresInSec: number }): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const out = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      // Quiet mode reports per-key failures in the body instead of throwing.
      if (out?.Errors?.length) {
        const failed = out.Errors.map((e) => `${e.Key} (${e.Code})`).join(', ');
        throw new Error(`Storage refused to delete: ${failed}`);
      }
    }
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const found: ListedObject[] = [];
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of out.Contents ?? []) {
        if (o.Key) {
          found.push({
            key: o.Key,
            sizeBytes: o.Size ?? 0,
            lastModified: o.LastModified ?? new Date(0),
          });
        }
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return found;
  }
}

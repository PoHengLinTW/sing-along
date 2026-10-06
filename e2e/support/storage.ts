import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const BUCKET = 'sing-along-e2e';
const client = new S3Client({
  endpoint: process.env.E2E_S3_ENDPOINT ?? 'http://localhost:9000',
  region: 'auto',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.E2E_S3_KEY ?? 'minioadmin',
    secretAccessKey: process.env.E2E_S3_SECRET ?? 'minioadmin',
  },
});

/** The object keys stored for a project's tracks, straight from the bucket. */
export async function storedKeys(projectId: number): Promise<string[]> {
  const res = await client.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `projects/${projectId}/tracks/` }),
  );
  return (res.Contents ?? []).map((o) => o.Key as string).sort();
}

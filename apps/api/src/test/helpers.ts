import type { ObjectInfo, Storage } from '../storage/types';

export class FakeStorage implements Storage {
  deleted: string[] = [];
  failDelete = false;
  objects = new Map<string, ObjectInfo>();
  presignedPuts: { key: string; contentType: string; sizeBytes: number; expiresInSec: number }[] =
    [];

  async presignPut(opts: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSec: number;
  }) {
    this.presignedPuts.push(opts);
    return `https://storage.test/put/${opts.key}?sig=x`;
  }
  async presignGet({ key }: { key: string; expiresInSec: number }) {
    return `https://storage.test/get/${key}?sig=y`;
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  async deleteObjects(keys: string[]) {
    if (this.failDelete) throw new Error('storage down');
    this.deleted.push(...keys);
    for (const k of keys) this.objects.delete(k);
  }
}

import type { Storage } from '../storage/types';

export class FakeStorage implements Storage {
  deleted: string[] = [];
  failDelete = false;
  async deleteObjects(keys: string[]) {
    if (this.failDelete) throw new Error('storage down');
    this.deleted.push(...keys);
  }
}

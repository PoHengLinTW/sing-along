import { concatChunks } from './take';

export interface TakeMeta {
  id: string;
  sampleRate: number;
  startSec: number;
  status: 'recording' | 'finished';
  createdAt: number;
}

interface ChunkRow {
  takeId: string;
  index: number;
  samples: Float32Array;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));

/** IndexedDB store for in-progress takes: PCM chunks are written during recording so a crash keeps the take. */
export class TakeStore {
  private constructor(private db: IDBDatabase) {}

  static async open(name = 'sing-along-spike'): Promise<TakeStore> {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('takes', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['takeId', 'index'] });
    };
    return new TakeStore(await req(open));
  }

  async createTake(m: { sampleRate: number; startSec: number }): Promise<string> {
    const meta: TakeMeta = { id: crypto.randomUUID(), status: 'recording', createdAt: Date.now(), ...m };
    const tx = this.db.transaction('takes', 'readwrite');
    tx.objectStore('takes').put(meta);
    await done(tx);
    return meta.id;
  }

  /** One transaction per batch keeps write overhead low (about one per second while recording). */
  async appendChunks(takeId: string, firstIndex: number, chunks: Float32Array[]): Promise<void> {
    const tx = this.db.transaction('chunks', 'readwrite');
    const os = tx.objectStore('chunks');
    chunks.forEach((samples, i) => os.put({ takeId, index: firstIndex + i, samples } satisfies ChunkRow));
    await done(tx);
  }

  async finishTake(id: string): Promise<void> {
    const tx = this.db.transaction('takes', 'readwrite');
    const os = tx.objectStore('takes');
    const meta = (await req(os.get(id))) as TakeMeta;
    os.put({ ...meta, status: 'finished' });
    await done(tx);
  }

  async listUnfinished(): Promise<TakeMeta[]> {
    const all = (await req(this.db.transaction('takes').objectStore('takes').getAll())) as TakeMeta[];
    return all.filter((t) => t.status === 'recording');
  }

  async loadTake(id: string): Promise<TakeMeta & { samples: Float32Array }> {
    const tx = this.db.transaction(['takes', 'chunks']);
    const meta = (await req(tx.objectStore('takes').get(id))) as TakeMeta | undefined;
    if (!meta) throw new Error(`take ${id} not found`);
    const rows = (await req(tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Infinity])))) as ChunkRow[];
    rows.sort((a, b) => a.index - b.index);
    return { ...meta, samples: concatChunks(rows.map((r) => r.samples)) };
  }

  async deleteTake(id: string): Promise<void> {
    const tx = this.db.transaction(['takes', 'chunks'], 'readwrite');
    tx.objectStore('takes').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
    await done(tx);
  }
}

/** Buffers chunks from the audio thread and flushes them to the store on a timer. */
export class ChunkWriter {
  private pending: Float32Array[] = [];
  private nextIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(private store: TakeStore, private takeId: string, opts: { flushEveryMs?: number } = {}) {
    const every = opts.flushEveryMs ?? 1000;
    if (every > 0) this.timer = setInterval(() => void this.flush(), every);
  }

  push(samples: Float32Array): void {
    this.pending.push(samples);
  }

  /** Serialised so batches land in order even if a flush overlaps the next tick. */
  flush(): Promise<void> {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return this.chain;
    const first = this.nextIndex;
    this.nextIndex += batch.length;
    this.chain = this.chain.then(() => this.store.appendChunks(this.takeId, first, batch));
    return this.chain;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

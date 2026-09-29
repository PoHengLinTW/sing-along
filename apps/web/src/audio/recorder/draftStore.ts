export type DraftStatus = 'recording' | 'encoding' | 'ready';

/** A take that exists only in this browser until the user uploads it. */
export interface Draft {
  id: string;
  projectId: number;
  startOffsetMs: number;
  latencyOffsetMs: number;
  sampleRate: number;
  createdAt: number;
  status: DraftStatus;
  name: string;
  performer: string;
  /** Filled by the encoder (M2-06) when status becomes `ready`. */
  blob?: Blob;
  mimeType?: string;
  peaks?: number[];
  durationMs?: number;
  labelIds?: number[];
}

export type NewDraft = Pick<
  Draft,
  'projectId' | 'startOffsetMs' | 'sampleRate' | 'name' | 'performer'
>;

interface ChunkRow {
  draftId: string;
  index: number;
  samples: Float32Array;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * IndexedDB store for drafts: PCM chunks are written while recording, so a crash or reload
 * keeps the take. Drafts are kept per project (indexed by projectId).
 */
export class DraftStore {
  private constructor(private db: IDBDatabase) {}

  static async open(name = 'sing-along-drafts'): Promise<DraftStore> {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      db.createObjectStore('chunks', { keyPath: ['draftId', 'index'] });
    };
    return new DraftStore(await req(open));
  }

  async createDraft(input: NewDraft): Promise<Draft> {
    const draft: Draft = {
      ...input,
      id: crypto.randomUUID(),
      latencyOffsetMs: 0,
      createdAt: Date.now(),
      status: 'recording',
    };
    const tx = this.db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put(draft);
    await done(tx);
    return draft;
  }

  async getDraft(id: string): Promise<Draft | undefined> {
    return req<Draft | undefined>(this.db.transaction('drafts').objectStore('drafts').get(id));
  }

  /** Oldest first, so "Take N" numbering and lane order are stable. */
  async listDrafts(projectId: number): Promise<Draft[]> {
    const rows = await req<Draft[]>(
      this.db.transaction('drafts').objectStore('drafts').index('projectId').getAll(projectId),
    );
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  }

  async updateDraft(id: string, patch: Partial<Omit<Draft, 'id'>>): Promise<Draft> {
    const tx = this.db.transaction('drafts', 'readwrite');
    const os = tx.objectStore('drafts');
    const current = await req<Draft | undefined>(os.get(id));
    if (!current) {
      tx.abort();
      throw new Error(`draft ${id} not found`);
    }
    const next = { ...current, ...patch, id };
    os.put(next);
    await done(tx);
    return next;
  }

  /** One transaction per batch keeps write overhead low (about one per second while recording). */
  async appendChunks(draftId: string, firstIndex: number, chunks: Float32Array[]): Promise<void> {
    const tx = this.db.transaction('chunks', 'readwrite');
    const os = tx.objectStore('chunks');
    chunks.forEach((samples, i) => {
      os.put({ draftId, index: firstIndex + i, samples } satisfies ChunkRow);
    });
    await done(tx);
  }

  async loadSamples(draftId: string): Promise<{ samples: Float32Array; chunkCount: number }> {
    const rows = await req<ChunkRow[]>(
      this.db.transaction('chunks').objectStore('chunks').getAll(chunkRange(draftId)),
    );
    rows.sort((a, b) => a.index - b.index);
    return { samples: concat(rows.map((r) => r.samples)), chunkCount: rows.length };
  }

  /** Frees the raw PCM once the encoded file is saved on the draft. */
  async deleteChunks(draftId: string): Promise<void> {
    const tx = this.db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').delete(chunkRange(draftId));
    await done(tx);
  }

  async deleteDraft(id: string): Promise<void> {
    const tx = this.db.transaction(['drafts', 'chunks'], 'readwrite');
    tx.objectStore('drafts').delete(id);
    tx.objectStore('chunks').delete(chunkRange(id));
    await done(tx);
  }

  /**
   * Drafts still marked `recording` when the page loads were cut short (crash, reload, closed tab).
   * Mark them `encoding` so the encoder finalises what was captured. Call this before starting a
   * new recording, or the live one would be picked up too.
   */
  async recoverInterrupted(projectId: number): Promise<Draft[]> {
    const interrupted = (await this.listDrafts(projectId)).filter((d) => d.status === 'recording');
    return Promise.all(interrupted.map((d) => this.updateDraft(d.id, { status: 'encoding' })));
  }
}

/** Buffers chunks from the audio thread and flushes them to the store on a timer. */
export class ChunkWriter {
  private pending: Float32Array[] = [];
  private nextIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private store: DraftStore,
    private draftId: string,
    opts: { flushEveryMs?: number } = {},
  ) {
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
    this.chain = this.chain.then(() => this.store.appendChunks(this.draftId, first, batch));
    return this.chain;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

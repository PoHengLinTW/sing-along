import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSync, createStatusStore, type SyncTrack } from './sync';

const track = (id: number, over: Partial<SyncTrack> = {}): SyncTrack => ({
  id,
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  ...over,
});
const buf = (d = 10) => ({ duration: d }) as unknown as AudioBuffer;

function setup() {
  const controller = {
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    setOffsets: vi.fn(),
  };
  const pending = new Map<
    number,
    { resolve: (b: AudioBuffer) => void; reject: (e: Error) => void }
  >();
  const load = vi.fn(
    (t: SyncTrack) =>
      new Promise<AudioBuffer>((resolve, reject) => {
        pending.set(t.id, { resolve, reject });
      }),
  );
  const status = createStatusStore();
  const sync = new AudioSync(controller as never, load, status);
  return { controller, load, status, sync, pending };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('AudioSync', () => {
  it('loads new tracks: loading, then added to the engine and ready', async () => {
    ctx.sync.sync([track(1, { startOffsetMs: 500 })]);
    expect(ctx.status.getState().byId[1]).toBe('loading');
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    expect(ctx.controller.addTrack).toHaveBeenCalledWith({
      id: 1,
      buffer: expect.anything(),
      startOffsetMs: 500,
      latencyOffsetMs: 0,
    });
    expect(ctx.status.getState().byId[1]).toBe('ready');
  });

  it('does not reload a track it already has', async () => {
    ctx.sync.sync([track(1)]);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    ctx.sync.sync([track(1)]);
    expect(ctx.load).toHaveBeenCalledTimes(1);
  });

  it('does not start a second load while the first is in flight', () => {
    ctx.sync.sync([track(1)]);
    ctx.sync.sync([track(1)]);
    expect(ctx.load).toHaveBeenCalledTimes(1);
  });

  it('marks a failed load as error and allows a retry on the next sync', async () => {
    ctx.sync.sync([track(1)]);
    ctx.pending.get(1)?.reject(new Error('boom'));
    await flush();
    expect(ctx.status.getState().byId[1]).toBe('error');
    ctx.sync.sync([track(1)]);
    expect(ctx.load).toHaveBeenCalledTimes(2);
  });

  it('retry(id) reloads a track that failed, and ignores tracks that are loading or ready', async () => {
    ctx.sync.sync([track(1), track(2)]);
    ctx.pending.get(1)?.reject(new Error('boom'));
    await flush();
    ctx.sync.retry(1);
    expect(ctx.status.getState().byId[1]).toBe('loading');
    expect(ctx.load).toHaveBeenCalledTimes(3); // 1, 2, then 1 again
    ctx.sync.retry(2); // still loading: no second download
    expect(ctx.load).toHaveBeenCalledTimes(3);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    expect(ctx.controller.addTrack).toHaveBeenCalledTimes(1);
    expect(ctx.status.getState().byId[1]).toBe('ready');
    ctx.sync.retry(1); // ready: nothing to do
    expect(ctx.load).toHaveBeenCalledTimes(3);
  });

  it('removes tracks that disappeared from the project', async () => {
    ctx.sync.sync([track(1), track(2)]);
    ctx.pending.get(1)?.resolve(buf());
    ctx.pending.get(2)?.resolve(buf());
    await flush();
    ctx.sync.sync([track(2)]);
    expect(ctx.controller.removeTrack).toHaveBeenCalledWith(1);
    expect(ctx.status.getState().byId[1]).toBeUndefined();
  });

  it('ignores a load that finishes after its track was removed', async () => {
    ctx.sync.sync([track(1)]);
    ctx.sync.sync([]);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    expect(ctx.controller.addTrack).not.toHaveBeenCalled();
  });

  it('applies offset changes to loaded tracks without reloading', async () => {
    ctx.sync.sync([track(1)]);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    ctx.sync.sync([track(1, { latencyOffsetMs: -120 })]);
    expect(ctx.controller.setOffsets).toHaveBeenCalledWith(1, {
      startOffsetMs: 0,
      latencyOffsetMs: -120,
    });
    expect(ctx.load).toHaveBeenCalledTimes(1);
  });

  it('uses the latest offsets if they changed while the buffer was loading', async () => {
    ctx.sync.sync([track(1)]);
    ctx.sync.sync([track(1, { startOffsetMs: 900 })]);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    expect(ctx.controller.addTrack).toHaveBeenCalledWith(
      expect.objectContaining({ startOffsetMs: 900 }),
    );
  });

  it('dispose removes everything it added', async () => {
    ctx.sync.sync([track(1)]);
    ctx.pending.get(1)?.resolve(buf());
    await flush();
    ctx.sync.dispose();
    expect(ctx.controller.removeTrack).toHaveBeenCalledWith(1);
  });
});

describe('AudioSync when a loaded track gets different audio', () => {
  const v = (n: string, over: Partial<SyncTrack> = {}) => track(1, { version: n, ...over });
  const load1 = async (version = 'v1') => {
    ctx.sync.sync([v(version)]);
    ctx.pending.get(1)?.resolve(buf(10));
    await flush();
    ctx.controller.addTrack.mockClear();
    ctx.controller.removeTrack.mockClear();
    ctx.load.mockClear();
  };

  it('loads the new audio and swaps it into the engine', async () => {
    await load1();
    const fresh = buf(4);
    ctx.sync.sync([v('v2')]);
    expect(ctx.load).toHaveBeenCalledTimes(1);
    ctx.pending.get(1)?.resolve(fresh);
    await flush();
    expect(ctx.controller.removeTrack).toHaveBeenCalledWith(1);
    expect(ctx.controller.addTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, buffer: fresh }),
    );
  });

  it('keeps playing the old audio until the new audio is ready, and stays "ready"', async () => {
    await load1();
    ctx.sync.sync([v('v2')]);
    expect(ctx.controller.removeTrack).not.toHaveBeenCalled();
    expect(ctx.status.getState().byId[1]).toBe('ready');
    ctx.pending.get(1)?.resolve(buf(4));
    await flush();
    expect(ctx.status.getState().byId[1]).toBe('ready');
  });

  it('removes the old track before adding the new one', async () => {
    await load1();
    const order: string[] = [];
    ctx.controller.removeTrack.mockImplementation(() => void order.push('remove'));
    ctx.controller.addTrack.mockImplementation(() => void order.push('add'));
    ctx.sync.sync([v('v2')]);
    ctx.pending.get(1)?.resolve(buf(4));
    await flush();
    expect(order).toEqual(['remove', 'add']);
  });

  it('places the new audio at the latest offsets, also if they changed while it loaded', async () => {
    await load1();
    ctx.sync.sync([v('v2', { startOffsetMs: 1000 })]);
    ctx.sync.sync([v('v2', { startOffsetMs: 1000, latencyOffsetMs: 250 })]);
    ctx.pending.get(1)?.resolve(buf(4));
    await flush();
    expect(ctx.controller.addTrack).toHaveBeenCalledWith(
      expect.objectContaining({ startOffsetMs: 1000, latencyOffsetMs: 250 }),
    );
  });

  it('does not reload for an offset change alone, or when there is no version', async () => {
    await load1();
    ctx.sync.sync([v('v1', { latencyOffsetMs: 40 })]);
    expect(ctx.load).not.toHaveBeenCalled();
    expect(ctx.controller.setOffsets).toHaveBeenCalled();

    const plain = setup();
    plain.sync.sync([track(2)]);
    plain.pending.get(2)?.resolve(buf());
    await flush();
    plain.load.mockClear();
    plain.sync.sync([track(2, { latencyOffsetMs: 5 })]);
    expect(plain.load).not.toHaveBeenCalled();
  });

  it('asks only once when the same new audio is announced again while loading', async () => {
    await load1();
    ctx.sync.sync([v('v2')]);
    ctx.sync.sync([v('v2')]);
    expect(ctx.load).toHaveBeenCalledTimes(1);
  });

  it('ignores a slower, older reload when a newer one was asked for', async () => {
    await load1();
    ctx.sync.sync([v('v2')]);
    const first = ctx.pending.get(1);
    ctx.sync.sync([v('v3')]);
    const second = ctx.pending.get(1);
    expect(first).not.toBe(second);
    const newest = buf(3);
    second?.resolve(newest);
    await flush();
    first?.resolve(buf(99));
    await flush();
    expect(ctx.controller.addTrack).toHaveBeenCalledTimes(1);
    expect(ctx.controller.addTrack).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: newest }),
    );
  });

  it('keeps the old audio if the new audio cannot be loaded, and tries again on the next sync', async () => {
    await load1();
    ctx.sync.sync([v('v2')]);
    ctx.pending.get(1)?.reject(new Error('decode failed'));
    await flush();
    expect(ctx.controller.removeTrack).not.toHaveBeenCalled();
    expect(ctx.status.getState().byId[1]).toBe('ready');
    ctx.sync.sync([v('v2')]);
    expect(ctx.load).toHaveBeenCalledTimes(2);
  });

  it('drops the result if the track was removed while it reloaded', async () => {
    await load1();
    ctx.sync.sync([v('v2')]);
    ctx.sync.sync([]);
    ctx.controller.addTrack.mockClear();
    ctx.pending.get(1)?.resolve(buf(4));
    await flush();
    expect(ctx.controller.addTrack).not.toHaveBeenCalled();
  });
});

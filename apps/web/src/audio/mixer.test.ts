import { beforeEach, describe, expect, it } from 'vitest';
import { AudioController } from './controller';
import { AudioEngine } from './engine';
import { FakeBuffer, FakeContext } from './fake';
import { createMixerStore, DEFAULT_MIX } from './mixerStore';
import { createTransportStore } from './transportStore';

let ctx: FakeContext;
let controller: AudioController;
let mixer: ReturnType<typeof createMixerStore>;

beforeEach(() => {
  ctx = new FakeContext();
  mixer = createMixerStore();
  controller = new AudioController(
    new AudioEngine(() => ctx as never),
    createTransportStore(),
    undefined,
    mixer,
  );
});
const add = (id: number) =>
  controller.addTrack({
    id,
    buffer: new FakeBuffer(10) as never,
    startOffsetMs: 0,
    latencyOffsetMs: 0,
  });
const gainOf = (i: number) => ctx.gains[i]?.gain.value;

describe('mixer store', () => {
  it('defaults to 100%, not muted, not soloed', () => {
    expect(mixer.getState().get(99)).toEqual(DEFAULT_MIX);
    expect(DEFAULT_MIX).toEqual({ volume: 1, muted: false, solo: false });
  });

  it('setVolume clamps to 0-150%', () => {
    mixer.getState().setVolume(1, 2);
    expect(mixer.getState().get(1).volume).toBe(1.5);
    mixer.getState().setVolume(1, -1);
    expect(mixer.getState().get(1).volume).toBe(0);
  });

  it('toggles mute and solo per track', () => {
    mixer.getState().toggleMute(1);
    mixer.getState().toggleSolo(1);
    expect(mixer.getState().get(1)).toMatchObject({ muted: true, solo: true });
    mixer.getState().toggleMute(1);
    expect(mixer.getState().get(1).muted).toBe(false);
  });

  it('forget removes a track and reset restores defaults', () => {
    mixer.getState().setVolume(1, 0.5);
    mixer.getState().setVolume(2, 0.7);
    mixer.getState().forget(1);
    expect(mixer.getState().byId[1]).toBeUndefined();
    mixer.getState().reset();
    expect(mixer.getState().byId).toEqual({});
  });
});

describe('mixer move (a draft becomes an uploaded track)', () => {
  it('carries volume, mute and solo to the new id and forgets the old one', () => {
    const m = createMixerStore();
    m.getState().setVolume(-5, 0.4);
    m.getState().toggleMute(-5);
    m.getState().toggleSolo(-5);
    m.getState().move(-5, 12);
    expect(m.getState().get(12)).toEqual({ volume: 0.4, muted: true, solo: true });
    expect(m.getState().byId[-5]).toBeUndefined();
  });

  it('does nothing when the draft was never mixed', () => {
    const m = createMixerStore();
    m.getState().move(-5, 12);
    expect(m.getState().byId).toEqual({});
  });
});

describe('mixer bound to the engine', () => {
  it('changes take effect live on loaded tracks (gain nodes)', () => {
    add(1);
    add(2);
    mixer.getState().setVolume(1, 0.4);
    expect(gainOf(0)).toBe(0.4);
    mixer.getState().toggleSolo(2);
    expect(gainOf(0)).toBe(0); // 1 is silenced by 2's solo
    expect(gainOf(1)).toBe(1);
    mixer.getState().toggleMute(2);
    expect(gainOf(1)).toBe(0); // mute beats solo
  });

  it('a track loaded later gets the mix that was set before it arrived', () => {
    mixer.getState().setVolume(7, 1.2);
    mixer.getState().toggleMute(8);
    add(7);
    add(8);
    expect(gainOf(0)).toBe(1.2);
    expect(gainOf(1)).toBe(0);
  });

  it('works while stopped and does not restart playback', async () => {
    add(1);
    mixer.getState().setVolume(1, 0.5);
    expect(ctx.sources).toHaveLength(0);
    await controller.play();
    const before = ctx.sources.length;
    mixer.getState().setVolume(1, 0.9);
    expect(ctx.sources).toHaveLength(before);
  });
});

describe('mixer copy', () => {
  it('gives another id the same volume, mute and solo, leaving the first as it was', async () => {
    const { createMixerStore } = await import('./mixerStore');
    const s = createMixerStore();
    s.getState().setVolume(1, 0.4);
    s.getState().toggleSolo(1);
    s.getState().copy(1, -5);
    expect(s.getState().get(-5)).toEqual({ volume: 0.4, muted: false, solo: true });
    expect(s.getState().get(1)).toEqual({ volume: 0.4, muted: false, solo: true });
    s.getState().setVolume(-5, 1);
    expect(s.getState().get(1).volume).toBe(0.4);
  });

  it('does nothing when the first id has no settings yet', async () => {
    const { createMixerStore } = await import('./mixerStore');
    const s = createMixerStore();
    s.getState().copy(1, -5);
    expect(s.getState().byId).toEqual({});
  });
});

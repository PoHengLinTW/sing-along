import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftView } from './recorder/draftView';
import { useDraftAudio } from './useDraftAudio';

const view = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
  projectId: 1,
  mimeType: 'audio/flac',
  engineId: -5,
  name: 'Take 1',
  performer: '',
  startOffsetMs: 1000,
  latencyOffsetMs: 0,
  durationMs: 2000,
  peaks: [0.5],
  blob: new Blob([new Uint8Array(4)]),
  ...over,
});

const controller = {
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
  setOffsets: vi.fn(),
};
const decode = vi.fn(async () => ({ duration: 2 }) as never);

beforeEach(() => {
  for (const fn of Object.values(controller)) fn.mockClear();
  decode.mockClear();
});

const render = (initial: DraftView[]) =>
  renderHook(({ drafts }) => useDraftAudio(drafts, { controller: controller as never, decode }), {
    initialProps: { drafts: initial },
  });

describe('useDraftAudio', () => {
  it('decodes a ready draft and plays it in the engine under its own id, at its offsets', async () => {
    render([view()]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    expect(controller.addTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: -5, startOffsetMs: 1000, latencyOffsetMs: 0 }),
    );
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('removes a discarded draft from the engine', async () => {
    const { rerender } = render([view()]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalled());
    rerender({ drafts: [] });
    expect(controller.removeTrack).toHaveBeenCalledWith(-5);
  });

  it('applies an offset change without decoding again', async () => {
    const { rerender } = render([view()]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalled());
    rerender({ drafts: [view({ latencyOffsetMs: -30 })] });
    expect(controller.setOffsets).toHaveBeenCalledWith(-5, {
      startOffsetMs: 1000,
      latencyOffsetMs: -30,
    });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('removes everything when the page is left', async () => {
    const { unmount } = render([view()]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalled());
    unmount();
    expect(controller.removeTrack).toHaveBeenCalledWith(-5);
  });
});

describe('useDraftAudio after the take is edited', () => {
  const edited = (size: number, over: Partial<DraftView> = {}) =>
    view({ blob: new Blob([new Uint8Array(size)]), durationMs: size * 100, ...over });

  it('plays the edited audio: decodes the new file and swaps it into the engine', async () => {
    const { rerender } = render([edited(4)]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ drafts: [edited(2)] }); // trimmed: a smaller, shorter file under the same draft id
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(2));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(controller.removeTrack).toHaveBeenCalledWith(-5);
  });

  it('plays the audio of an edit that was undone: the earlier file comes back', async () => {
    const { rerender } = render([edited(4)]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ drafts: [edited(2)] });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(2));
    rerender({ drafts: [edited(4)] });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(3));
  });

  it('does not decode again for a rename, or when the same file is read back from storage', async () => {
    const { rerender } = render([edited(4)]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ drafts: [edited(4, { name: 'Alto' })] }); // a new Blob object, same content
    await new Promise((r) => setTimeout(r, 20));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(controller.addTrack).toHaveBeenCalledTimes(1);
  });

  it('does not decode again for a Start time change', async () => {
    const { rerender } = render([edited(4)]);
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ drafts: [edited(4, { latencyOffsetMs: 300 })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(controller.setOffsets).toHaveBeenCalled();
  });
});

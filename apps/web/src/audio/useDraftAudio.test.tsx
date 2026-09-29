import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftView } from './recorder/draftView';
import { useDraftAudio } from './useDraftAudio';

const view = (over: Partial<DraftView> = {}): DraftView => ({
  id: 'd1',
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

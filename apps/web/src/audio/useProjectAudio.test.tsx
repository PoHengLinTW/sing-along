import type { TrackDto } from '@sing-along/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = vi.hoisted(() => ({
  addTrack: vi.fn(),
  removeTrack: vi.fn(),
  setOffsets: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
}));
const loadTrackBuffer = vi.hoisted(() => vi.fn(async () => ({ duration: 3 }) as never));
vi.mock('./controller', () => ({ getAudioController: () => controller }));
vi.mock('./loadTrackBuffer', () => ({ loadTrackBuffer }));

import { trackVersion, useProjectAudio } from './useProjectAudio';

const track = (over: Partial<TrackDto> = {}): TrackDto => ({
  id: 1,
  projectId: 1,
  name: 'Alto',
  performer: null,
  labels: [],
  startOffsetMs: 0,
  latencyOffsetMs: 0,
  durationMs: 8000,
  mimeType: 'audio/flac',
  sizeBytes: 4000,
  source: 'upload',
  sortOrder: 1,
  peaks: [0.1, 0.9],
  createdAt: '',
  ...over,
});

beforeEach(() => {
  for (const fn of [...Object.values(controller), loadTrackBuffer]) fn.mockClear();
});

describe('trackVersion', () => {
  it('changes when the audio is overwritten, not when only the placement or the name changes', () => {
    const v = trackVersion(track());
    expect(trackVersion(track({ sizeBytes: 3000 }))).not.toBe(v);
    expect(trackVersion(track({ durationMs: 5000 }))).not.toBe(v);
    expect(trackVersion(track({ peaks: [0.1, 0.5] }))).not.toBe(v);
    expect(trackVersion(track({ latencyOffsetMs: 300, name: 'Soprano' }))).toBe(v);
  });
});

describe('useProjectAudio', () => {
  it('loads each track once and plays it', async () => {
    renderHook(({ tracks }) => useProjectAudio(tracks), { initialProps: { tracks: [track()] } });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    expect(loadTrackBuffer).toHaveBeenCalledWith(1, trackVersion(track()));
  });

  it('plays the new audio after a track was overwritten', async () => {
    const { rerender } = renderHook(({ tracks }) => useProjectAudio(tracks), {
      initialProps: { tracks: [track()] },
    });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ tracks: [track({ sizeBytes: 2500, durationMs: 4000, peaks: [0.4] })] });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(2));
    expect(controller.removeTrack).toHaveBeenCalledWith(1);
    expect(loadTrackBuffer).toHaveBeenCalledTimes(2);
  });

  it('does not download again for a rename or a Start time change', async () => {
    const { rerender } = renderHook(({ tracks }) => useProjectAudio(tracks), {
      initialProps: { tracks: [track()] },
    });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ tracks: [track({ name: 'Soprano', latencyOffsetMs: 200 })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(loadTrackBuffer).toHaveBeenCalledTimes(1);
    expect(controller.setOffsets).toHaveBeenCalled();
  });

  it('stops playing a track that is no longer in the list (checked out for editing)', async () => {
    const { rerender } = renderHook(({ tracks }) => useProjectAudio(tracks), {
      initialProps: { tracks: [track()] },
    });
    await waitFor(() => expect(controller.addTrack).toHaveBeenCalledTimes(1));
    rerender({ tracks: [] });
    expect(controller.removeTrack).toHaveBeenCalledWith(1);
  });
});
